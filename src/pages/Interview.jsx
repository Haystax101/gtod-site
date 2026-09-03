import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { startVoiceSession } from '../lib/voiceClient'
import '../styles/voice.css'

/**
 * Live voice with Charge: mock interviews and check-in calls.
 *
 * The nervous-user problem shapes this screen. Someone about to practise for an
 * interview they are scared of will not read instructions, so the page says
 * exactly three things before the call: how long it lasts, that they can stop
 * whenever, and that nobody else hears it. Everything else waits.
 */
export default function Interview() {
  const allowance = useQuery(api.voice.myVoiceAllowance)
  const startCall = useAction(api.voice.start)
  const heartbeat = useMutation(api.voice.heartbeat)
  const endCall = useMutation(api.voice.end)

  const [kind, setKind] = useState('interview')
  const [state, setState] = useState({ status: 'idle' })
  const [error, setError] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const sessionRef = useRef(null)
  const sessionIdRef = useRef(null)

  // A call must never outlive the page. Without this the microphone can stay
  // open after navigation, which is both a privacy problem and a billing one.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop('navigated-away').then((secs) => {
          if (sessionIdRef.current) {
            endCall({ sessionId: sessionIdRef.current, seconds: secs }).catch(() => {})
          }
        })
      }
    }
  }, [endCall])

  const begin = useCallback(async () => {
    setError(null)
    setState({ status: 'connecting' })
    try {
      const session = await startCall({ kind })
      sessionIdRef.current = session.sessionId

      sessionRef.current = startVoiceSession({
        // Path taken from the official @google/genai SDK (v2.21.0), which builds
        // `${base}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent`
        // for the Gemini Developer API. voiceClient appends ?access_token=,
        // which is the query parameter the SDK uses for ephemeral credentials
        // (a raw API key would use ?key= instead - we never send one).
        url:
          import.meta.env.VITE_VOICE_WS_URL ??
          'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
        model: import.meta.env.VITE_VOICE_MODEL,
        token: session.token,
        sessionMinutes: session.sessionMinutes,
        system: session.system ?? '',
        context: session.context ?? '',
        onState: (s) => {
          setState(s)
          if (typeof s.seconds === 'number') setSeconds(s.seconds)
          if (s.status === 'ended' && sessionIdRef.current) {
            endCall({ sessionId: sessionIdRef.current, seconds: s.seconds ?? 0 }).catch(() => {})
            sessionRef.current = null
            sessionIdRef.current = null
          }
          if (s.status === 'error') setError(s.error)
        },
        onHeartbeat: async (secs) => {
          setSeconds(secs)
          if (!sessionIdRef.current) return
          try {
            const res = await heartbeat({ sessionId: sessionIdRef.current, seconds: secs })
            if (res?.stop) sessionRef.current?.stop('time-limit')
          } catch {
            // A failed heartbeat is not worth ending a good call over; the
            // server reconciles abandoned sessions on its own.
          }
        },
      })
    } catch (err) {
      const msg = String(err?.message ?? err)
      setError(msg.replace(/^.*ConvexError:\s*/, '').replace(/^LIMIT:/, ''))
      setState({ status: 'idle' })
    }
  }, [kind, startCall, endCall, heartbeat])

  const finish = useCallback(async () => {
    if (!sessionRef.current) return
    const secs = await sessionRef.current.stop('user-ended')
    if (sessionIdRef.current) {
      await endCall({ sessionId: sessionIdRef.current, seconds: secs }).catch(() => {})
    }
    sessionRef.current = null
    sessionIdRef.current = null
  }, [endCall])

  const live = state.status === 'live' || state.status === 'connecting'
  const mins = Math.floor(seconds / 60)
  const secs = String(seconds % 60).padStart(2, '0')
  const noMinutes = allowance && allowance.remainingMinutes < 1

  return (
    <main className="voice-page">
      <header className="voice-head">
        <p className="section-tag">Practice out loud</p>
        <h1>Mock interviews with <span className="hl">Charge</span></h1>
        <p className="copy">
          A real spoken interview, one question at a time, then honest feedback.
          Nobody else hears it, and you can stop whenever you like.
        </p>
      </header>

      {allowance && (
        <p className="voice-allowance" aria-live="polite">
          <strong>{allowance.remainingMinutes}</strong> of {allowance.monthlyMinutes} minutes
          left this month · up to {allowance.maxSessionMinutes} minutes per call
        </p>
      )}

      {!live && (
        <div className="voice-choices" role="radiogroup" aria-label="Call type">
          <button
            type="button" role="radio" aria-checked={kind === 'interview'}
            className={`voice-choice ${kind === 'interview' ? 'is-on' : ''}`}
            onClick={() => setKind('interview')}
          >
            <span className="voice-choice-name">Mock interview</span>
            <span className="voice-choice-sub">
              Competency and motivational questions, then feedback
            </span>
          </button>
          <button
            type="button" role="radio" aria-checked={kind === 'checkin'}
            className={`voice-choice ${kind === 'checkin' ? 'is-on' : ''}`}
            onClick={() => setKind('checkin')}
          >
            <span className="voice-choice-name">Check-in call</span>
            <span className="voice-choice-sub">
              Five minutes on where your applications are up to
            </span>
          </button>
        </div>
      )}

      <div className="voice-stage">
        {live ? (
          <>
            <div className={`voice-orb ${state.status === 'live' ? 'is-live' : ''}`} aria-hidden="true" />
            <p className="voice-status" aria-live="polite">
              {state.status === 'connecting' ? 'Connecting…' : 'Listening'}
            </p>
            <p className="voice-timer" aria-label={`${mins} minutes ${secs} seconds elapsed`}>
              {mins}:{secs}
            </p>
            <button type="button" className="btn btn-ghost" onClick={finish}>
              End call
            </button>
          </>
        ) : (
          <button
            type="button" className="btn btn-orange voice-start"
            onClick={begin} disabled={noMinutes}
          >
            {noMinutes ? 'No minutes left this month' : 'Start the call'}
          </button>
        )}
      </div>

      {error && <p className="voice-error" role="alert">{error}</p>}

      {state.status === 'ended' && !error && (
        <p className="voice-done" role="status">
          Call finished — {mins}m {secs}s. That practice counts; the more you do out loud,
          the less the real one costs you.
        </p>
      )}

      <p className="voice-fineprint">
        Charge is practice, not a real interviewer, and it can be wrong about a
        specific employer. Always check details against the employer's own page.
      </p>
    </main>
  )
}
