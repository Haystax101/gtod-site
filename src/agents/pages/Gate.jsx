import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'

export default function Gate() {
  const { setToken } = useSession()
  const [mode, setMode] = useState('join')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const signUp = useAction(api.auth.signUp)
  const logIn = useAction(api.auth.logIn)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (mode === 'join' && password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const { token } = mode === 'join' ? await signUp({ handle, password }) : await logIn({ handle, password })
      setToken(token)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <div className="gate-logo">
          <img src="/assets/logo.png" alt="Get There One Day" />
          <div>
            <div className="name">GTOD <span>Field Operations</span></div>
            <div className="sub">RESTRICTED ACCESS</div>
          </div>
        </div>

        <div className="card bracket">
          <div className="stampwrap"><span className="stamp">Classified</span></div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Form <b>01</b> · Enrolment</div>
          <h1 className="display" style={{ marginBottom: 6 }}>
            {mode === 'join' ? 'Become an agent' : 'Report in'}
          </h1>
          <p className="muted small" style={{ marginBottom: 18 }}>
            {mode === 'join'
              ? <>An exclusive programme for GTOD followers. Missions, ranks, and a direct line to the Lead Operative. Enrolment is open to <span className="redact">followers only</span>.</>
              : 'Welcome back, agent.'}
          </p>

          <div className="switch">
            <button type="button" className={mode === 'join' ? 'on' : ''} onClick={() => { setMode('join'); setError(null) }}>Enrol</button>
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError(null) }}>Log in</button>
          </div>

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="handle">Your TikTok username</label>
              <div className="input-prefix">
                <span>@</span>
                <input
                  id="handle"
                  className="input mono"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="exactly as it is on TikTok"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  required
                />
              </div>
              {mode === 'join' && (
                <div className="hint">
                  This must be your <b>TikTok</b> username, not a nickname. It is how HQ knows you are one of us,
                  and it is the name other agents will see.
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="pw">{mode === 'join' ? 'Create a password' : 'Password'}</label>
              <input
                id="pw"
                className="input"
                type="password"
                autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {mode === 'join' && <div className="hint">At least 8 characters. There is no email reset, so pick one you will remember.</div>}
            </div>
            {mode === 'join' && (
              <div className="field">
                <label htmlFor="pw2">Confirm password</label>
                <input id="pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
            )}

            {error && <div className="error">{error}</div>}

            <button className="btn block" type="submit" disabled={busy} style={{ marginTop: 18 }}>
              {busy ? <span className="spin" /> : mode === 'join' ? 'Enrol as Junior Agent' : 'Log in'}
            </button>
          </form>
        </div>

        <div className="foot">
          {mode === 'join' && <>By enrolling you agree to the <Link to="/terms">programme rules</Link>.<br /></>}
          Locked out? Message <a href="https://www.tiktok.com/@getthereonedaypod" target="_blank" rel="noreferrer">@getthereonedaypod</a> on TikTok.
          <br /><a href="/">← getthereoneday.com</a>
        </div>
      </div>
    </div>
  )
}
