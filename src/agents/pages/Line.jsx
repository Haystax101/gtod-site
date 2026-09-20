import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { stamp } from '../lib/format'

/** The agent's side of the direct line. HQ's side lives in HQ.jsx. */
export default function Line() {
  const { token, me } = useSession()
  const messages = useQuery(api.directLine.mine, { token })
  const send = useMutation(api.directLine.send)
  const markRead = useMutation(api.directLine.markRead)
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
    if (messages?.some((m) => m.fromLead && m.readAt === undefined)) markRead({ token }).catch(() => {})
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  async function go(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await send({ token, body })
      setBody('')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  if (me.rank === 'lead') return <Navigate to="/hq#inbox" replace />

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Secure channel · <b>Lead Operative</b></span>
        <h1 className="display">Direct line</h1>
        <p className="small">Report progress, ask for a ruling, or tell George something. Only you and HQ can see this.</p>
      </div>

      <div className="card">
        {messages === undefined ? (
          <div className="empty"><span className="spin" /></div>
        ) : messages.length === 0 ? (
          <div className="empty">Channel open. Nothing sent yet.</div>
        ) : (
          <div className="chat">
            {messages.map((m) => (
              <div key={m._id} className={`msg ${m.fromLead ? 'theirs' : 'mine'}`}>
                {m.body}
                <span className="when">{m.fromLead ? 'HQ · ' : ''}{stamp(m.createdAt)}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="composer">
        <form onSubmit={go}>
          <textarea className="input" placeholder="Message HQ…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1500} required rows={1} />
          <button className="btn" type="submit" disabled={busy}>{busy ? <span className="spin" /> : 'Send'}</button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
