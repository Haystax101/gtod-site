import { Link } from 'react-router-dom'

export function RankPill({ rank, rankLabel, small }) {
  return <span className={`pill rankpill rank-${rank}${small ? '' : ' solid'}`}>{rankLabel}</span>
}

export function LoyalPill() {
  return <span className="pill gold" title="Has funded the operation">★ Loyal</span>
}

export function Avatar({ agent, lg }) {
  const letter = (agent?.displayHandle ?? '?')[0]
  return <span className={`avatar${lg ? ' lg' : ''} rank-${agent?.rank ?? 'junior'}`}>{letter}</span>
}

export function Handle({ agent, link = true }) {
  if (!agent) return <span className="mono dim">[retired]</span>
  const inner = <>@{agent.displayHandle}</>
  return link ? <Link to={`/a/${agent.handle}`} style={{ textDecoration: 'none' }}>{inner}</Link> : inner
}

export function StatusPill({ status }) {
  const map = {
    processing: ['amber', 'Awaiting HQ'], // legacy rows, before the rescue cron moves them
    pending: ['amber', 'HQ reading it'],
    approved: ['green', 'Up on the brief'],
    rejected: ['red', 'Not approved'],
  }
  const [cls, label] = map[status] ?? ['', status]
  return <span className={`pill ${cls}`}>{label}</span>
}

export function YearPill({ agent }) {
  if (!agent?.yearLabel) return null
  return <span className="pill">{agent.yearLabel}</span>
}

/** Whether a field report is visible to other agents once approved. */
export function VisibilityPill({ visibility }) {
  const isPublic = (visibility ?? 'public') === 'public'
  return (
    <span className={`pill ${isPublic ? 'teal' : 'solid'}`} title={isPublic ? 'Other agents can read this. Fair game for a video.' : 'Only this agent and HQ can read it. Ask before using it.'}>
      {isPublic ? 'Public' : '🔒 Private'}
    </span>
  )
}
