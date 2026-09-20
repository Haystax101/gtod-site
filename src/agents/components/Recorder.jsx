import { useEffect, useRef, useState } from 'react'
import { mmss } from '../lib/format'

export const MAX_SECONDS = 180
const BARS = 24

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const c of candidates) if (window.MediaRecorder?.isTypeSupported?.(c)) return c
  return ''
}

/**
 * Hold-nothing voice recorder: tap to start, tap to stop, hear it back, keep
 * or discard. Calls onRecording({ blob, durationSec, mimeType }) or
 * onRecording(null) when discarded.
 */
export default function Recorder({ onRecording, disabled }) {
  const [state, setState] = useState('idle') // idle | live | done | denied | unsupported
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState(() => Array(BARS).fill(4))
  const [previewUrl, setPreviewUrl] = useState(null)
  const rec = useRef(null)
  const chunks = useRef([])
  const timer = useRef(null)
  const startedAt = useRef(0)
  const audioCtx = useRef(null)
  const raf = useRef(0)
  const stream = useRef(null)

  useEffect(() => {
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) setState('unsupported')
    return () => stopAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    clearInterval(timer.current)
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
  }

  function meter(s) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      audioCtx.current = ctx
      const src = ctx.createMediaStreamSource(s)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const step = Math.max(1, Math.floor(data.length / BARS))
        setLevels(Array.from({ length: BARS }, (_, i) => 4 + Math.round((data[i * step] / 255) * 24)))
        raf.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      /* the meter is decoration; recording works without it */
    }
  }

  async function start() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = s
      const mimeType = pickMimeType()
      const r = new MediaRecorder(s, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : { audioBitsPerSecond: 48_000 })
      chunks.current = []
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      r.onstop = () => {
        const type = r.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunks.current, { type })
        const durationSec = Math.min(MAX_SECONDS, Math.round((Date.now() - startedAt.current) / 1000))
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        setState('done')
        onRecording({ blob, durationSec, mimeType: type })
        stopAll()
      }
      rec.current = r
      startedAt.current = Date.now()
      r.start(1000)
      setSeconds(0)
      setState('live')
      meter(s)
      timer.current = setInterval(() => {
        const el = Math.round((Date.now() - startedAt.current) / 1000)
        setSeconds(el)
        if (el >= MAX_SECONDS) stop()
      }, 250)
    } catch (err) {
      setState(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'unsupported')
    }
  }

  function stop() {
    clearInterval(timer.current)
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSeconds(0)
    setState('idle')
    onRecording(null)
  }

  if (state === 'unsupported') {
    return <div className="notice">Recording is not supported in this browser. Use the upload option below, or open this page in Safari / Chrome.</div>
  }
  if (state === 'denied') {
    return (
      <div className="notice">
        Microphone access was blocked. Allow it in your browser settings and reload, or upload a voice memo instead.
        <div style={{ marginTop: 8 }}><button type="button" className="linkbtn" onClick={() => setState('idle')}>Try again</button></div>
      </div>
    )
  }

  return (
    <div className="recorder">
      {state === 'done' ? (
        <>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <span className="pill green">Recorded · {mmss(seconds)}</span>
          </div>
          <audio className="player" controls src={previewUrl} />
          <div style={{ marginTop: 10 }}>
            <button type="button" className="linkbtn" onClick={discard} disabled={disabled}>Discard and re-record</button>
          </div>
        </>
      ) : (
        <>
          <div className="eyebrow">{state === 'live' ? <><b>● REC</b> · tap to stop</> : 'Tap to record'}</div>
          <button type="button" className={`recbtn${state === 'live' ? ' live' : ''}`} onClick={state === 'live' ? stop : start} disabled={disabled} aria-label={state === 'live' ? 'Stop recording' : 'Start recording'}>
            {state === 'live' ? (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            )}
          </button>
          <div className={`rectime${state === 'live' ? ' live' : ''}`}>{mmss(seconds)} <span className="dim">/ {mmss(MAX_SECONDS)}</span></div>
          <div className="wave" aria-hidden="true">
            {levels.map((h, i) => <i key={i} style={{ height: state === 'live' ? h : 4 }} />)}
          </div>
        </>
      )}
    </div>
  )
}
