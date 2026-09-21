import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import Prose from '../components/Prose'
import { Avatar, RankPill } from '../components/Badges'

function longDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function DispatchList() {
  const { token, me } = useSession()
  const rows = useQuery(api.dispatches.list, { token })
  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">From the Lead Operative · <b>Written</b></span>
        <h1 className="display">Dispatches</h1>
        <p className="small">The stuff that does not fit in a video: uni, health, productivity, getting there. Members only.</p>
        {me.rank === 'lead' && <Link to="/hq#dispatches" className="btn sm" style={{ marginTop: 10 }}>Write a dispatch</Link>}
      </div>
      <div className="card">
        {rows === undefined && <div className="empty"><span className="spin" /></div>}
        {rows?.length === 0 && <div className="empty">Nothing filed yet.</div>}
        {rows?.map((d) => (
          <Link key={d._id} to={`/dispatches/${d._id}`} className="dispatch-row">
            <div className="eyebrow">{longDate(d.publishedAt)} · {Math.max(1, Math.round(d.words / 200))} min read</div>
            <div className="t">{d.title}</div>
            <div className="x">{d.excerpt}{d.excerpt.length >= 160 ? '…' : ''}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function Dispatch() {
  const { id } = useParams()
  const { token } = useSession()
  const d = useQuery(api.dispatches.get, { token, id })
  if (d === undefined) return <div className="empty"><span className="spin" /></div>
  if (d === null) return <div className="empty">No such dispatch.</div>
  return (
    <div className="stack">
      <Link to="/dispatches" className="backlink">← Dispatches</Link>
      <article className="card bracket dispatch">
        <div className="eyebrow">Dispatch · <b>{longDate(d.publishedAt ?? d.createdAt)}</b>{d.status === 'draft' && ' · DRAFT'}</div>
        <h1 className="display" style={{ margin: '8px 0 14px' }}>{d.title}</h1>
        {d.author && (
          <div className="row" style={{ marginBottom: 18 }}>
            <Avatar agent={d.author} />
            <div>
              <div className="mono small">@{d.author.displayHandle}</div>
              <RankPill rank={d.author.rank} rankLabel={d.author.rankLabel} small />
            </div>
          </div>
        )}
        <Prose text={d.body} />
      </article>
    </div>
  )
}
