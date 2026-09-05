/**
 * Browser client for a live voice session with Charge.
 *
 * Responsibilities, in order of how much they matter:
 *   1. Never run longer than the server allowed. The server's credential TTL is
 *      the real enforcement, but the client stops itself too so a user is never
 *      surprised by a hard disconnect mid-sentence.
 *   2. Release the microphone. Always, on every exit path. A page that keeps
 *      the mic light on after a call is a trust-destroying bug.
 *   3. Report elapsed time so spend is recorded accurately even if the tab dies.
 *
 * PROVIDER NOTE - VERIFY BEFORE LAUNCH
 * The transport below is written against the shape of a realtime audio
 * WebSocket API (open a socket with an ephemeral credential, stream PCM frames
 * up, receive PCM frames down). The exact frame format and handshake for the
 * chosen provider could not be confirmed from the build environment, which has
 * no network access. Everything else in this file - capture, resampling,
 * playback scheduling, teardown, timing - is provider-independent.
 * When wiring the real protocol, change only `encodeFrame`, `decodeFrame` and
 * the `onmessage` branch.
 */

/** The Live API family conventionally takes 16 kHz mono in, 24 kHz mono out. */
const INPUT_SAMPLE_RATE = 16000
const OUTPUT_SAMPLE_RATE = 24000
/** How often we tell the server we are still talking. */
const HEARTBEAT_MS = 10000

/** Float32 [-1,1] to 16-bit little-endian PCM, which is what these APIs want. */
function floatTo16BitPCM(input) {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Cheap linear resample. Good enough for speech; avoids pulling in a library. */
function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.round(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, input.length - 1)
    out[i] = input[lo] + (input[hi] - input[lo]) * (idx - lo)
  }
  return out
}

function encodeFrame(pcm16) {
  // Shape taken from @google/genai v2.21.0, Session.sendRealtimeInput: it sends
  // {realtimeInput: {audio: {data, mimeType}}}. The bare {audio: ...} this used
  // to send is not a message the server recognises.
  let binary = ''
  const bytes = new Uint8Array(pcm16.buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return JSON.stringify({
    realtimeInput: {
      audio: { data: btoa(binary), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
    },
  })
}

/** Base64 to Int16 PCM. */
function pcmFromBase64(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

/**
 * Read one server frame.
 *
 * Shapes verified against @google/genai v2.21.0. Audio arrives as inlineData
 * parts on serverContent.modelTurn (a Content), never as a top-level `audio`
 * field, which is what this looked for before and why nothing ever played.
 */
function decodeFrame(raw) {
  const empty = { text: null, chunks: [], setupComplete: false, error: null }
  try {
    const msg = JSON.parse(raw)
    if (msg?.setupComplete) return { ...empty, setupComplete: true }
    // The server reports a rejected setup or a policy stop in-band.
    const err = msg?.error ?? msg?.goAway
    if (err) return { ...empty, error: err.message ?? JSON.stringify(err).slice(0, 200) }

    const server = msg?.serverContent
    const parts = server?.modelTurn?.parts ?? []
    const chunks = []
    for (const part of parts) {
      if (part?.inlineData?.data) chunks.push(pcmFromBase64(part.inlineData.data))
    }
    const spoken = parts.map((part) => part?.text).filter(Boolean).join('')
    const text = server?.outputTranscription?.text || spoken || null
    return { text, chunks, setupComplete: false, error: null }
  } catch {
    return empty
  }
}

/**
 * The Live model every call uses unless VITE_VOICE_MODEL overrides it.
 *
 * Voice was dark in production because this had no default and the variable was
 * never set: the client threw ConfigError before it ever opened a socket. A
 * default that matches the rate convex/budget.ts is costed against (see
 * VOICE_USD_PER_MINUTE) keeps the two honest. Model ids do get retired - when
 * one does, `GEMINI_API_KEY=... tools/voice/list-live-models.sh` prints what the
 * key can actually run today, and that id goes in VITE_VOICE_MODEL.
 */
export const DEFAULT_VOICE_MODEL = 'gemini-3.1-flash-live-preview'

/**
 * Start a call.
 *
 * @param {object} opts
 * @param {string} opts.url           provider websocket endpoint
 * @param {string} opts.model         live model id, e.g. from VITE_VOICE_MODEL
 * @param {string} opts.token         short-lived credential minted server-side
 * @param {number} opts.sessionMinutes hard ceiling from the server
 * @param {string} opts.system        system instruction for this session
 * @param {string} [opts.context]     the user's applications/tasks, spoken context
 * @param {(s: object) => void} opts.onState   state changes for the UI
 * @param {(sec: number) => void} [opts.onHeartbeat] report elapsed seconds
 * @returns {{ stop: (reason?: string) => Promise<number> }}
 */
export function startVoiceSession(opts) {
  const {
    url, token, model, sessionMinutes, system, context = '',
    onState = () => {}, onHeartbeat = () => {}, onTick = () => {},
  } = opts

  const startedAt = Date.now()
  const maxMs = sessionMinutes * 60_000
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000)

  let socket = null
  let stream = null
  let audioCtx = null
  let source = null
  let processor = null
  let playbackCtx = null
  let tick = null
  let playHead = 0
  let heartbeat = null
  let hardStop = null
  let stopped = false
  /** True once the server has accepted setup: before that nothing may stream. */
  let ready = false
  /** Set when we have already reported a specific reason, so close stays quiet. */
  let failure = null

  /** Every exit path funnels through here. The microphone must always close. */
  async function stop(reason = 'ended') {
    if (stopped) return elapsed()
    stopped = true
    clearInterval(heartbeat)
    clearInterval(tick)
    clearTimeout(hardStop)
    try { processor?.disconnect() } catch { /* already gone */ }
    try { source?.disconnect() } catch { /* already gone */ }
    try { stream?.getTracks().forEach((t) => t.stop()) } catch { /* already gone */ }
    try { await audioCtx?.close() } catch { /* already gone */ }
    try { await playbackCtx?.close() } catch { /* already gone */ }
    try { socket?.close() } catch { /* already gone */ }
    onState({ status: 'ended', reason, seconds: elapsed() })
    return elapsed()
  }

  async function begin() {
    try {
      onState({ status: 'connecting' })

      if (!model) {
        throw Object.assign(new Error('no-model'), { name: 'ConfigError' })
      }
      // The Live API wants the fully-qualified resource name ('models/<id>').
      // A bare id opens the socket and then closes it with nothing useful to
      // report, so accept either spelling and send the one it expects.
      const qualifiedModel = model.startsWith('models/') ? model : `models/${model}`

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })

      audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE })
      playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })
      // getUserMedia is awaited above, which breaks the gesture chain from the
      // click that started the call. Safari in particular then leaves the
      // context suspended, so everything looks correct and nothing is audible.
      await Promise.all([
        audioCtx.state === 'suspended' ? audioCtx.resume() : null,
        playbackCtx.state === 'suspended' ? playbackCtx.resume() : null,
      ].filter(Boolean)).catch(() => {})
      source = audioCtx.createMediaStreamSource(stream)
      // ScriptProcessor is deprecated but is the only option that works without
      // shipping a separate worklet file; the buffer is small enough that the
      // main-thread cost is not audible. Move to an AudioWorklet if it bites.
      processor = audioCtx.createScriptProcessor(4096, 1, 1)

      socket = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`)

      socket.onopen = () => {
        // Every field here is mapped the way liveConnectParametersToMldev maps
        // it in @google/genai v2.21.0. systemInstruction is a Content, not a
        // string, and generationConfig carries the modalities. The previous
        // `audioConfig` key does not exist in this protocol at all - the input
        // rate is declared on each audio blob's mimeType instead.
        socket.send(JSON.stringify({
          setup: {
            model: qualifiedModel,
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: {
              parts: [{ text: context ? `${system}\n\n${context}` : system }],
            },
          },
        }))
      }

      // The microphone opens on setupComplete, not on socket open. A rejected
      // setup closes the socket straight after opening, and starting to stream
      // before the server has accepted it is what made a failed call look like
      // a call that ran for two seconds and ended.
      const goLive = () => {
        if (ready) return
        ready = true
        onState({ status: 'live', seconds: 0 })
        processor.onaudioprocess = (e) => {
          if (socket?.readyState !== WebSocket.OPEN) return
          const input = e.inputBuffer.getChannelData(0)
          const resampled = resample(input, audioCtx.sampleRate, INPUT_SAMPLE_RATE)
          socket.send(encodeFrame(floatTo16BitPCM(resampled)))
        }
        source.connect(processor)
        processor.connect(audioCtx.destination)
        heartbeat = setInterval(() => onHeartbeat(elapsed()), HEARTBEAT_MS)
        // The heartbeat is a server round trip, so it stays infrequent. The
        // clock on screen is local and free, and should move every second.
        tick = setInterval(() => onTick(elapsed()), 1000)
        onTick(elapsed())
      }

      socket.onmessage = async (event) => {
        // Browsers hand binary frames over as a Blob; the SDK reads them as
        // text the same way.
        const raw = typeof event.data === 'string' ? event.data : await event.data.text()
        const { chunks, text, setupComplete, error: serverError } = decodeFrame(raw)

        if (setupComplete) return goLive()
        if (serverError) {
          failure = serverError
          onState({ status: 'error', error: `The voice service refused the call: ${serverError}` })
          return stop('server-error')
        }
        if (text) onState({ status: 'live', transcript: text, seconds: elapsed() })
        if (!playbackCtx) return
        if (playbackCtx.state === 'suspended') await playbackCtx.resume().catch(() => {})
        for (const pcm of chunks) {
          // Schedule each chunk after the previous one so speech does not overlap.
          const buffer = playbackCtx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE)
          const channel = buffer.getChannelData(0)
          for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000
          const node = playbackCtx.createBufferSource()
          node.buffer = buffer
          node.connect(playbackCtx.destination)
          playHead = Math.max(playHead, playbackCtx.currentTime)
          node.start(playHead)
          playHead += buffer.duration
        }
      }

      socket.onerror = () => stop('connection-error')
      // A close before setupComplete means the server rejected the session.
      // The code and reason are the only diagnosis available, so surface them
      // instead of discarding them and reporting a call that simply ended.
      socket.onclose = (e) => {
        if (!ready && !stopped && !failure) {
          const detail = [e?.code, e?.reason].filter(Boolean).join(' ')
          onState({
            status: 'error',
            error: `The voice service closed the call before it started${detail ? ` (${detail})` : ''}. This usually means the model id or the session credential was rejected.`,
          })
        }
        stop('closed')
      }
      // Belt and braces alongside the credential TTL: stop ourselves just
      // before the server would, so the user gets a clean ending rather than a
      // mid-sentence cut.
      hardStop = setTimeout(() => stop('time-limit'), maxMs - 2000)
    } catch (err) {
      onState({
        status: 'error',
        error:
          err?.name === 'ConfigError'
            ? 'Voice is not configured yet: no model is set. Set VITE_VOICE_MODEL and rebuild.'
            : err?.name === 'NotAllowedError'
              ? 'Charge needs microphone access for a call. Allow it in your browser and try again.'
              : 'Could not start the call. Check your connection and try again.',
      })
      await stop('error')
    }
  }

  begin()
  return { stop }
}
