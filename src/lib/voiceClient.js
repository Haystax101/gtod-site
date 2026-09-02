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
  // Base64 PCM in a JSON envelope is the common shape. Confirm against the
  // provider's own protocol docs before launch.
  let binary = ''
  const bytes = new Uint8Array(pcm16.buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return JSON.stringify({ audio: { data: btoa(binary), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` } })
}

function decodeFrame(raw) {
  try {
    const msg = JSON.parse(raw)
    const b64 = msg?.audio?.data ?? msg?.serverContent?.audio?.data
    if (!b64) return { text: msg?.text ?? msg?.serverContent?.text ?? null, pcm: null }
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { text: null, pcm: new Int16Array(bytes.buffer) }
  } catch {
    return { text: null, pcm: null }
  }
}

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
    onState = () => {}, onHeartbeat = () => {},
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
  let playHead = 0
  let heartbeat = null
  let hardStop = null
  let stopped = false

  /** Every exit path funnels through here. The microphone must always close. */
  async function stop(reason = 'ended') {
    if (stopped) return elapsed()
    stopped = true
    clearInterval(heartbeat)
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

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })

      audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE })
      playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })
      source = audioCtx.createMediaStreamSource(stream)
      // ScriptProcessor is deprecated but is the only option that works without
      // shipping a separate worklet file; the buffer is small enough that the
      // main-thread cost is not audible. Move to an AudioWorklet if it bites.
      processor = audioCtx.createScriptProcessor(4096, 1, 1)

      socket = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`)

      socket.onopen = () => {
        socket.send(JSON.stringify({
          setup: {
            // The Live API keys the session to a model here. Without it the
            // socket opens and then closes with nothing useful to report, so
            // the caller is required to supply one.
            model,
            systemInstruction: context ? `${system}\n\n${context}` : system,
            audioConfig: { sampleRateHertz: INPUT_SAMPLE_RATE },
          },
        }))
        onState({ status: 'live', seconds: 0 })

        processor.onaudioprocess = (e) => {
          if (socket?.readyState !== WebSocket.OPEN) return
          const input = e.inputBuffer.getChannelData(0)
          const resampled = resample(input, audioCtx.sampleRate, INPUT_SAMPLE_RATE)
          socket.send(encodeFrame(floatTo16BitPCM(resampled)))
        }
        source.connect(processor)
        processor.connect(audioCtx.destination)
      }

      socket.onmessage = (event) => {
        const { pcm, text } = decodeFrame(event.data)
        if (text) onState({ status: 'live', transcript: text, seconds: elapsed() })
        if (!pcm || !playbackCtx) return
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

      socket.onerror = () => stop('connection-error')
      socket.onclose = () => stop('closed')

      heartbeat = setInterval(() => onHeartbeat(elapsed()), HEARTBEAT_MS)
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
