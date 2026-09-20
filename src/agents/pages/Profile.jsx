import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar, LoyalPill, RankPill } from '../components/Badges'
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
            <div className="row" style={{ marginTop: 6 }}><RankPill rank={a.rank} rankLabel={a.rankLabel} /></div>
          </div>
        </div>
        {a.bio && <p className="muted small" style={{ marginTop: 14 }}>{a.bio}</p>}
        <div className="stats">
          <div className="stat"><div className="n">{a.points}</div><div className="l">Verified</div></div>
          <div className="stat"><div className="n">{a.missions.length}</div><div className="l">Missions</div></div>
          <div className="stat"><div className="n">{timeAgo(a.createdAt).replace(' ago', '')}</div><div className="l">Enrolled</div></div>
        </div>
        <a className="linkbtn small" style={{ display: 'inline-block', marginTop: 14 }} href={`https://www.tiktok.com/@${a.handle}`} target="_blank" rel="noreferrer">TikTok ↗</a>
      </div>
      <div className="card">
        <div className="card-head"><span className="eyebrow">Verified missions</span></div>
        {a.missions.length === 0 ? (
          <div className="empty">None yet.</div>
        ) : (
          a.missions.map((m) => (
            <div key={m._id} className="feed-item">
              <div className="txt">{m.freeformTitle ?? 'Mission'} · {pluralise(m.verifiedCount, 'encounter')}</div>
              <span className="when">{m.reviewedAt ? timeAgo(m.reviewedAt) : ''}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
