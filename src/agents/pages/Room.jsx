import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { Avatar, Handle, RankPill } from '../components/Badges'
import { stamp, timeAgo } from '../lib/format'

/** A year room: one live stream, newest at the bottom, like a group chat. */
export default function Room() {
  const { room } = useParams()
  const { token, me } = useSession()
  const data = useQuery(api.rooms.messages, { token, room })
  const send = useMutation(api.rooms.send)
  const moderate = useMutation(api.rooms.moderate)
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const isLead = me.rank === 'lead'

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [data?.messages.length])

  if (data === undefined) return <div className="empty"><span className="spin" /></div>
  if (data === null) return <div className="empty">That room is not yours.</div>

  async function go(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await send({ token, room, body })
      setBody('')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  // Group consecutive messages from the same author within five minutes.
  const groups = []
  for (const m of data.messages) {
    const last = groups[groups.length - 1]
    if (last && last.authorId === m.authorId && m.createdAt - last.at < 5 * 60 * 1000) { last.items.push(m); last.at = m.createdAt }
    else groups.push({ authorId: m.authorId, author: m.author, at: m.createdAt, first: m.createdAt, items: [m] })
  }

  return (
    <div className="stack">
      <Link to="/forum" className="backlink">← Forum</Link>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <span className="eyebrow">Year room · <b>Members of this year only</b></span>
        <h1 className="display" style={{ fontSize: 'clamp(1.4rem, 5vw, 2.2rem)' }}>{data.label}</h1>
      </div>

      <div className="card room">
        {groups.length === 0 && <div className="empty">Nobody has said anything yet. Go on.</div>}
        {groups.map((g) => {
          const mine = g.authorId === me._id
          return (
            <div key={g.items[0]._id} className={`rg${mine ? ' mine' : ''}`}>
              {!mine && <Avatar agent={g.author} />}
              <div className="rg-body">
                {!mine && (
                  <div className="rg-who">
                    <Handle agent={g.author} />
                    {g.author && <RankPill rank={g.author.rank} rankLabel={g.author.rankLabel} small />}
                    <span className="when">{timeAgo(g.first)}</span>
                  </div>
                )}
                {g.items.map((m) => (
                  <div key={m._id} className={`bubble${m.hidden ? ' hidden' : ''}`} title={stamp(m.createdAt)}>
                    {m.body}
                    {isLead && (
                      <button className="linkbtn tiny" style={{ marginLeft: 8 }} onClick={() => moderate({ token, messageId: m._id, hidden: !m.hidden })}>{m.hidden ? 'unhide' : 'hide'}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <form onSubmit={go}>
          <textarea className="input" placeholder={`Message the ${data.label.toLowerCase()}…`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} required rows={1}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); e.target.form.requestSubmit() } }} />
          <button className="btn" type="submit" disabled={busy}>{busy ? <span className="spin" /> : 'Send'}</button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
