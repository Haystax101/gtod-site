// Application stages, in the order a real application moves through them.
// `tone` maps onto the badge colours in timeline.css.
export const STAGES = [
  { id: 'interested', label: 'Interested', tone: 'quiet', short: 'Interested' },
  { id: 'applying', label: 'Writing the application', tone: 'live', short: 'Applying' },
  { id: 'submitted', label: 'Submitted', tone: 'live', short: 'Submitted' },
  { id: 'online_test', label: 'Online test', tone: 'live', short: 'Online test' },
  { id: 'video_interview', label: 'Video interview', tone: 'live', short: 'Video interview' },
  { id: 'assessment_centre', label: 'Assessment centre', tone: 'live', short: 'Assessment centre' },
  { id: 'final_interview', label: 'Final interview', tone: 'live', short: 'Final interview' },
  { id: 'offer', label: 'Offer', tone: 'win', short: 'Offer' },
  { id: 'rejected', label: 'Rejected', tone: 'closed', short: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn', tone: 'closed', short: 'Withdrawn' },
]

const BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]))

// Stages that still have work left in them. Used to decide what counts as an
// application you are actively running.
export const ACTIVE_STAGES = STAGES.filter((s) => s.tone === 'quiet' || s.tone === 'live').map((s) => s.id)

export function stageLabel(stage) {
  return BY_ID[stage]?.label ?? 'Tracking'
}

export function stageTone(stage) {
  return BY_ID[stage]?.tone ?? 'quiet'
}

// How far through the process this stage is, 0-1. Terminal stages return null
// so we don't draw a progress bar on a rejection.
export function stageProgress(stage) {
  const runway = ['interested', 'applying', 'submitted', 'online_test', 'video_interview', 'assessment_centre', 'final_interview', 'offer']
  const i = runway.indexOf(stage)
  if (i < 0) return null
  return (i + 1) / runway.length
}

export default function StageBadge({ stage, size = 'md', className = '' }) {
  const s = BY_ID[stage]
  const label = s?.label ?? 'Tracking'
  return (
    <span
      className={`stage-badge tone-${s?.tone ?? 'quiet'}${size === 'sm' ? ' sm' : ''}${className ? ` ${className}` : ''}`}
      title={`Stage: ${label}`}
    >
      <i aria-hidden="true" />
      {label}
    </span>
  )
}
