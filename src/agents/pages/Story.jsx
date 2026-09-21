import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { Avatar, Handle, LoyalPill, RankPill } from '../components/Badges'
import Reactions from '../components/Reactions'
import { pluralise, timeAgo } from '../lib/format'

const MAX_COMMENT = 1000

export default function Story() {
  const { submissionId } = useParams()
  const { token, me } = useSession()
  const s = useQuery(api.stories.get, { token, submissionId })
  const comment = useMutation(api.stories.comment)
  const removeComment = useMutation(api.stories.deleteComment)
  const report = useMutation(api.stories.report)
  const moderateComment = useMutation(api.stories.moderateComment)
  const navigate = useNavigate()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flagged, setFlagged] = useState(false)
  const isLead = me.rank === 'lead'

  if (s === undefined) return <div className="empty"><span className="spin" /></div>
  if (s === null) return <div className="empty">That story is not available. It may have been made private or taken down.</div>

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await comment({ token, submissionId, body })
      setBody('')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  async function flagStory() {
    const reason = window.prompt('Why should HQ look at this story?')
    if (reason === null) return
    try {
      await report({ token, submissionId, reason })
      setFlagged(true)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  async function flagComment(commentId) {
    const reason = window.prompt('Why should HQ look at this comment?')
    if (reason === null) return
    await report({ token, commentId, reason }).catch(() => {})
  }

  return (
    <div className="stack">
      <button className="backlink" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => navigate(-1)}>← Back</button>

      <article className="card">
        <div className="row" style={{ gap: 10 }}>
          <Avatar agent={s.agent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h"><b><Handle agent={s.agent} /></b></div>
            <div className="row" style={{ gap: 6, marginTop: 3 }}>
              {s.agent && <RankPill rank={s.agent.rank} rankLabel={s.agent.rankLabel} small />}
              {s.agent?.loyal && <LoyalPill />}
            </div>
          </div>
        </div>

        <div className="eyebrow" style={{ marginTop: 14 }}>
          <b>{s.title}</b> · {timeAgo(s.reviewedAt)}{s.points > 0 ? ` · ${pluralise(s.points, 'point')}` : ''}
        </div>
        <p className="story-full">{s.story}</p>

        {!s.published && (
          <div className="notice" style={{ marginTop: 12 }}>
            {s.mine ? 'This one is private. Only you and HQ can read it.' : 'Not published.'}
          </div>
        )}

        <div className="row between" style={{ marginTop: 14 }}>
          {s.published ? <Reactions submissionId={s._id} reactions={s.reactions} /> : <span />}
          {!s.mine && s.published && (
            <button className="linkbtn tiny" onClick={flagStory} disabled={flagged}>{flagged ? 'Reported' : 'Report'}</button>
          )}
        </div>
      </article>

      <div className="card">
        <div className="card-head">
          <span className="eyebrow">{pluralise(s.comments.length, 'comment')}</span>
        </div>
        {s.comments.length === 0 ? (
          <div className="empty">Nothing said yet. Go on.</div>
        ) : (
          s.comments.map((c) => (
            <div key={c._id} className={`post${c.hidden ? ' hidden' : ''}`}>
              <Avatar agent={c.author} />
              <div className="body">
                <div className="who">
                  <Link to={c.author ? `/a/${c.author.handle}` : '#'} className="h"><Handle agent={c.author} link={false} /></Link>
                  {c.author && <RankPill rank={c.author.rank} rankLabel={c.author.rankLabel} small />}
                  <span className="when">{timeAgo(c.createdAt)}</span>
                  {c.hidden && <span className="pill red">Hidden</span>}
                </div>
                <div className="txt">{c.body}</div>
                <div className="tools">
                  {c.authorId === me._id
                    ? <button className="linkbtn tiny" onClick={() => window.confirm('Delete your comment?') && removeComment({ token, commentId: c._id })}>Delete</button>
                    : <button className="linkbtn tiny" onClick={() => flagComment(c._id)}>Report</button>}
                  {isLead && <button className="linkbtn tiny" onClick={() => moderateComment({ token, commentId: c._id, hidden: !c.hidden })}>{c.hidden ? 'Unhide' : 'Hide'}</button>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {s.published && (
        <div className="composer">
          <form onSubmit={send}>
            <textarea className="input" placeholder="Say something…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_COMMENT} required rows={1} />
            <button className="btn" type="submit" disabled={busy}>{busy ? <span className="spin" /> : 'Send'}</button>
          </form>
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  )
}
