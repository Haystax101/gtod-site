import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar, Handle, LoyalPill, RankPill } from '../components/Badges'
import { fileNo, pluralise, timeAgo } from '../lib/format'

const LADDER = [
  ['junior', 'Junior Agent', 'Where everyone starts.'],
  ['senior', 'Senior Agent', 'Promoted by HQ for verified field work.'],
  ['advanced', 'Advanced Operative', 'The inner circle. HQ decides.'],
]

export default function Briefing() {
  const { me, token } = useSession()
  const feed = useQuery(api.missions.feed, { token })
  const mine = useQuery(api.missions.mine, { token })
  const unread = useQuery(api.directLine.unreadForMe, { token })
  const settings = useQuery(api.settings.get, {})

  const verified = (mine ?? []).filter((s) => s.status === 'approved').length
  const pending = (mine ?? []).filter((s) => s.status === 'pending' || s.status === 'processing').length
  const idx = LADDER.findIndex(([r]) => r === me.rank)

  return (
    <div className="stack">
      <div className="card bracket">
        <div className="card-head">
          <span className="eyebrow">Agent file <b>№ {fileNo(me._id)}</b></span>
          {me.loyal && <LoyalPill />}
        </div>
        <div className="idcard">
          <Avatar agent={me} lg />
          <div>
            <div className="name">@{me.displayHandle}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <RankPill rank={me.rank} rankLabel={me.rankLabel} />
            </div>
          </div>
        </div>
        <div className="stats">
          <div className="stat"><div className="n">{me.points}</div><div className="l">Verified</div></div>
          <div className="stat"><div className="n">{verified}</div><div className="l">Missions</div></div>
          <div className="stat"><div className="n">{pending}</div><div className="l">In review</div></div>
        </div>
        {me.bio && <p className="muted small" style={{ marginTop: 14 }}>{me.bio}</p>}
      </div>

      {unread > 0 && (
        <Link to="/line" className="card" style={{ display: 'block', textDecoration: 'none', borderColor: 'var(--orange)' }}>
          <div className="row between">
            <span className="eyebrow"><b>Direct line</b> · {pluralise(unread, 'new message')}</span>
            <span className="pill orange">Read →</span>
          </div>
        </Link>
      )}

      <div className="card">
        <div className="card-head">
          <span className="eyebrow">Standing orders</span>
        </div>
        <h2 className="display">Your first mission</h2>
        <p className="muted small" style={{ margin: '6px 0 14px' }}>
          Freshers' week. Strangers everywhere. Walk up to one and ask the only question that matters:
          <b className="hl"> "You here for uni then?"</b> Record it. Submit it. HQ's analyst verifies it in seconds.
        </p>
        <Link to="/missions" className="btn">Open missions</Link>
      </div>

      {me.rank !== 'lead' && (
        <div className="card">
          <div className="card-head"><span className="eyebrow">Clearance ladder</span></div>
          <div className="ladder">
            {LADDER.map(([r, label, blurb], i) => (
              <div key={r} className={`step${i === idx ? ' here' : i < idx ? ' done' : ''}`}>
                <span className="n">0{i + 1}</span>
                <div>
                  <div className="t">{label}</div>
                  <div className="tiny muted">{blurb}</div>
                </div>
                {i === idx && <span className="pill orange you">You</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="eyebrow">Field reports · <b>verified</b></span>
          <Link to="/board" className="tiny muted">Leaderboard →</Link>
        </div>
        {feed === undefined ? (
          <div className="empty"><span className="spin" /></div>
        ) : feed.length === 0 ? (
          <div className="empty">No verified missions yet. Be first.</div>
        ) : (
          feed.map((f) => (
            <div key={f._id} className="feed-item">
              <Avatar agent={f.agent} />
              <div className="txt">
                <b><Handle agent={f.agent} /></b> completed <span className="hl">{f.title}</span>
                {' '}· {pluralise(f.verifiedCount, 'encounter')}
              </div>
              <span className="when">{timeAgo(f.reviewedAt)}</span>
            </div>
          ))
        )}
      </div>

      {settings?.donateUrl && (
        <p className="footnote">
          <a href={`${settings.donateUrl}?client_reference_id=${me._id}`} target="_blank" rel="noreferrer">Fund the operation</a>
        </p>
      )}
    </div>
  )
}
