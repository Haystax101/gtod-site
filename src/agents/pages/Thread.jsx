import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { Avatar, Handle, LoyalPill, RankPill } from '../components/Badges'
import { timeAgo } from '../lib/format'
import { CATS } from './Forum'

export default function Thread() {
  const { threadId } = useParams()
  const { token, me } = useSession()
  const t = useQuery(api.forum.thread, { token, threadId })
  const reply = useMutation(api.forum.reply)
  const report = useMutation(api.forum.report)
  const moderatePost = useMutation(api.forum.moderatePost)
  const moderateThread = useMutation(api.forum.moderateThread)
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const isLead = me.rank === 'lead'

  if (t === undefined) return <div className="empty"><span className="spin" /></div>
  if (t === null) return <div className="empty">Thread not found.</div>

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await reply({ token, threadId, body })
      setBody('')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  async function flag(postId) {
    const reason = window.prompt('Why should HQ look at this post?')
    if (reason === null) return
    await report({ token, postId, reason }).catch(() => {})
  }

  return (
    <div className="stack">
      <Link to="/forum" className="backlink">← Forum</Link>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <span className="eyebrow">{CATS.find(([k]) => k === t.category)?.[1]} {t.pinned && <b>· Pinned</b>} {t.locked && '· Locked'}</span>
        <h1 className="display" style={{ fontSize: 'clamp(1.4rem, 5vw, 2.2rem)' }}>{t.title}</h1>
        {isLead && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn xs ghost" onClick={() => moderateThread({ token, threadId, pinned: !t.pinned })}>{t.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="btn xs ghost" onClick={() => moderateThread({ token, threadId, locked: !t.locked })}>{t.locked ? 'Unlock' : 'Lock'}</button>
            <button className="btn xs danger" onClick={() => moderateThread({ token, threadId, hidden: !t.hidden })}>{t.hidden ? 'Unhide' : 'Hide thread'}</button>
          </div>
        )}
      </div>

      <div className="card">
        {t.posts.map((p) => (
          <div key={p._id} className={`post${p.hidden ? ' hidden' : ''}`}>
            <Avatar agent={p.author} />
            <div className="body">
              <div className="who">
                <Link to={p.author ? `/a/${p.author.handle}` : '#'} className="h"><Handle agent={p.author} link={false} /></Link>
                {p.author && <RankPill rank={p.author.rank} rankLabel={p.author.rankLabel} small />}
                {p.author?.loyal && <LoyalPill />}
                <span className="when">{timeAgo(p.createdAt)}</span>
                {p.hidden && <span className="pill red">Hidden</span>}
              </div>
              <div className="txt">{p.body}</div>
              <div className="tools">
                {p.authorId !== me._id && <button className="linkbtn tiny" onClick={() => flag(p._id)}>Report</button>}
                {isLead && <button className="linkbtn tiny" onClick={() => moderatePost({ token, postId: p._id, hidden: !p.hidden })}>{p.hidden ? 'Unhide' : 'Hide'}</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {(!t.locked || isLead) && (
        <div className="composer">
          <form onSubmit={send}>
            <textarea className="input" placeholder="Reply…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required rows={1} />
            <button className="btn" type="submit" disabled={busy}>{busy ? <span className="spin" /> : 'Send'}</button>
          </form>
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  )
}
