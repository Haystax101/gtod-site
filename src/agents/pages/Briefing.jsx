import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar, Handle, LoyalPill, RankPill } from '../components/Badges'
import StoryText from '../components/StoryText'
import { fileNo, pluralise, timeAgo } from '../lib/format'

const LADDER = [
  ['junior', 'Junior Agent', 'Where everyone starts.'],
  ['senior', 'Senior Agent', 'Promoted by HQ for good field work.'],
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
            {me.university
              ? <div className="tiny muted" style={{ marginTop: 6 }}>{me.university}</div>
              : <Link to="/me" className="tiny" style={{ display: 'inline-block', marginTop: 6, color: 'var(--orange)' }}>Set your university →</Link>}
          </div>
        </div>
        <div className="stats">
          <div className="stat"><div className="n">{me.points}</div><div className="l">Points</div></div>
          <div className="stat"><div className="n">{verified}</div><div className="l">Stories up</div></div>
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
          <b className="hl"> "You here for uni then?"</b> Then write up how it went. HQ reads every report and decides what it earns.
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
          <span className="eyebrow">Field reports · <b>approved by HQ</b></span>
          <span className="row" style={{ gap: 10 }}>
            <Link to="/coverage" className="tiny muted">Coverage map →</Link>
            <Link to="/board" className="tiny muted">Leaderboard →</Link>
          </span>
        </div>
        {feed === undefined ? (
          <div className="empty"><span className="spin" /></div>
        ) : feed.length === 0 ? (
          <div className="empty">No stories up yet. Be first.</div>
        ) : (
          feed.map((f) => (
            <article key={f._id} className="story-item">
              <div className="row" style={{ gap: 10 }}>
                <Avatar agent={f.agent} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="h"><b><Handle agent={f.agent} /></b> · <span className="hl">{f.title}</span></div>
                  <div className="tiny dim">{timeAgo(f.reviewedAt)}{f.points > 0 && ` · ${pluralise(f.points, 'point')}`}</div>
                </div>
              </div>
              {f.story && <StoryText text={f.story} />}
            </article>
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
