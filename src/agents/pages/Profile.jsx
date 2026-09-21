import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar, LoyalPill, RankPill, YearPill } from '../components/Badges'
import StoryText from '../components/StoryText'
import { fileNo, pluralise, timeAgo } from '../lib/format'

export default function Profile() {
  const { handle } = useParams()
  const { token } = useSession()
  const a = useQuery(api.agents.profile, { token, handle })

  if (a === undefined) return <div className="empty"><span className="spin" /></div>
  if (a === null) return <div className="empty">No such agent.</div>

  return (
    <div className="stack">
      <Link to="/board" className="backlink">← Leaderboard</Link>
      <div className="card bracket">
        <div className="card-head">
          <span className="eyebrow">Agent file <b>№ {fileNo(a._id)}</b></span>
          {a.loyal && <LoyalPill />}
        </div>
        <div className="idcard">
          <Avatar agent={a} lg />
          <div>
            <div className="name">@{a.displayHandle}</div>
            <div className="row" style={{ marginTop: 6 }}><RankPill rank={a.rank} rankLabel={a.rankLabel} /><YearPill agent={a} /></div>
          </div>
        </div>
        {a.university && <div className="eyebrow" style={{ marginTop: 14 }}>Posted at <b>{a.university}</b></div>}
        {a.bio && <p className="muted small" style={{ marginTop: 10 }}>{a.bio}</p>}
        <div className="stats">
          <div className="stat"><div className="n">{a.points}</div><div className="l">Points</div></div>
          <div className="stat"><div className="n">{a.missions.length}</div><div className="l">Stories</div></div>
          <div className="stat"><div className="n">{timeAgo(a.createdAt).replace(' ago', '')}</div><div className="l">Enrolled</div></div>
        </div>
        <a className="linkbtn small" style={{ display: 'inline-block', marginTop: 14 }} href={`https://www.tiktok.com/@${a.handle}`} target="_blank" rel="noreferrer">TikTok ↗</a>
      </div>
      <div className="card">
        <div className="card-head"><span className="eyebrow">Field reports</span></div>
        {a.missions.length === 0 ? (
          <div className="empty">None yet.</div>
        ) : (
          a.missions.map((m) => (
            <article key={m._id} className="story-item">
              <div className="row between">
                <span className="h">
                  <span className="hl">{m.title}</span>
                  {m.private && <span className="pill" style={{ marginLeft: 8 }}>Private</span>}
                </span>
                <span className="when">{m.reviewedAt ? timeAgo(m.reviewedAt) : ''}{m.points > 0 ? ` · ${pluralise(m.points, 'point')}` : ''}</span>
              </div>
              {m.story && <StoryText text={m.story} />}
              {!m.private && <Link to={`/s/${m._id}`} className="tiny muted" style={{ textDecoration: 'none' }}>Open →</Link>}
            </article>
          ))
        )}
      </div>
    </div>
  )
}
