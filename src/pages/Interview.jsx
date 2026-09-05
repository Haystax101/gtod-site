import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SignInButton, SignUpButton } from '@clerk/clerk-react'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import { Wordmark } from '../components/Wordmark.jsx'
import AppNav from '../components/AppNav.jsx'
import { startVoiceSession, DEFAULT_VOICE_MODEL } from '../lib/voiceClient'
import '../styles/timeline.css'
import '../styles/voice.css'

const errorText = (err) => err?.data?.message ?? err?.data ?? err?.message ?? 'Something went wrong'

/**
 * Live voice with Charge: mock interviews and check-in calls.
 *
 * The nervous-user problem shapes this screen. Someone about to practise for an
 * interview they are scared of will not read instructions, so the page says
 * exactly three things before the call: how long it lasts, that they can stop
 * whenever, and that nobody else hears it. Everything else waits.
 */
/**
 * The call itself. Only ever rendered signed in and inside a boundary: every
 * query below throws for a signed-out caller, and Convex rethrows that during
 * render, which is a white screen rather than an error.
 */
function VoiceRoom() {
  // A Clerk identity is not yet a users row, and requireUser needs the row.
  const ensure = useMutation(api.users.ensure)
  useEffect(() => { ensure() }, [ensure])

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
        // `||` rather than `??`: an unset Vite variable is undefined, but one
        // declared-and-empty in .env (as .env.example ships it) is '', and an
        // empty string is not a usable endpoint or model id.
        url:
          import.meta.env.VITE_VOICE_WS_URL ||
          'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
        model: import.meta.env.VITE_VOICE_MODEL || DEFAULT_VOICE_MODEL,
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
      <AppNav />
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

function NotConfigured() {
  return (
    <div className="app-gate">
      <Wordmark />
      <h1>Mock interviews aren't switched on yet</h1>
      <p>This build has no Clerk or Convex keys, so we can't start a call. Add them and redeploy.</p>
      <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook instead</Link>
    </div>
  )
}

// Convex throws from useQuery when a query fails, so a boundary is the
// difference between "we couldn't load this" and a white screen.
class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null, key: 0 } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="app-page"><div className="wrap">
          <div className="app-error" role="alert">
            <strong>We couldn't start a practice call.</strong>
            <p>{errorText(this.state.error)}</p>
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>Try again</button>
              <Link className="btn btn-ghost btn-sm" to="/charge">Ask Charge instead</Link>
            </div>
          </div>
        </div></div>
      )
    }
    return <div key={this.state.key}>{this.props.children}</div>
  }
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) {
    return (
      <div className="app-page">
        <div className="wrap skel-stack" aria-busy="true" aria-label="Loading mock interviews">
          <div className="skel w-40" />
          <div className="skel" />
          <div className="skel" />
        </div>
      </div>
    )
  }
  if (!isAuthenticated) {
    return (
      <div className="app-gate">
        <div className="eyebrow">Practice out loud</div>
        <h1>Mock interviews with Charge</h1>
        <p>
          A real spoken interview, one question at a time, then honest feedback. Nobody else
          hears it, and you can stop whenever you like.
        </p>
        <ul className="feature-list">
          <li>Competency and motivational questions, asked out loud</li>
          <li>Feedback straight after, on what you actually said</li>
          <li>Or a five-minute check-in on where your applications are up to</li>
        </ul>
        <div className="cta-row">
          <SignUpButton mode="modal"><button type="button" className="btn btn-primary">Create a free account</button></SignUpButton>
          <SignInButton mode="modal"><button type="button" className="btn btn-secondary">Sign in</button></SignInButton>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Free, and it stays free. See our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.
        </p>
      </div>
    )
  }
  return <Boundary><VoiceRoom /></Boundary>
}

export default function Interview() {
  if (!backendConfigured) return <NotConfigured />
  return <Gate />
}
