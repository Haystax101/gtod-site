import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar, Handle, LoyalPill, RankPill } from '../components/Badges'

export default function Board() {
  const { token, me } = useSession()
  const rows = useQuery(api.agents.leaderboard, { token })

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Standings · <b>Verified encounters</b></span>
        <h1 className="display">Leaderboard</h1>
        <p className="small">Only verified encounters count. Claims without evidence go nowhere.</p>
      </div>
      <div className="cats">
        <Link to="/board" className="btn xs">Leaderboard</Link>
        <Link to="/coverage" className="btn xs ghost">Coverage map</Link>
      </div>
      <div className="card">
        {rows === undefined ? (
          <div className="empty"><span className="spin" /></div>
        ) : rows.length === 0 ? (
          <div className="empty">No agents ranked yet.</div>
        ) : (
          <ol className="board">
            {rows.map((a, i) => (
              <li key={a._id} className={a._id === me._id ? 'me' : ''}>
                <span className="pos">{i + 1}</span>
                <Avatar agent={a} />
                <div style={{ minWidth: 0 }}>
                  <div className="h"><Handle agent={a} /></div>
                  <div className="row" style={{ gap: 6, marginTop: 3 }}>
                    <RankPill rank={a.rank} rankLabel={a.rankLabel} small />
                    {a.loyal && <LoyalPill />}
                  </div>
                  {a.university && <div className="tiny muted" style={{ marginTop: 3 }}>{a.university}</div>}
                </div>
                <span className="pts">{a.points}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
