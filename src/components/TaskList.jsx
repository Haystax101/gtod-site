import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

// ---------------------------------------------------------------- date helpers
// Everything here is local-time and UK-shaped: weeks start on Monday, which is
// also how the backend keys `weekOf`.

export const DAY = 86400000

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfWeek(ts = Date.now()) {
  const d = new Date(startOfDay(ts))
  const shift = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - shift)
  return d.getTime()
}

export function isOverdue(dueAt, now = Date.now()) {
  return typeof dueAt === 'number' && dueAt < startOfDay(now)
}

// "Today", "Tomorrow", "Thursday", "2 days late", "12 Nov".
export function formatDue(dueAt, now = Date.now()) {
  if (typeof dueAt !== 'number') return null
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return '1 day late'
  if (days < -1 && days > -14) return `${-days} days late`
  if (days > 1 && days < 7) return new Date(dueAt).toLocaleDateString('en-GB', { weekday: 'long' })
  return new Date(dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatDate(ts) {
  if (typeof ts !== 'number') return null
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------- list

function TaskRow({ task, onToggle, pending }) {
  const done = Boolean(task.doneAt)
  const [celebrate, setCelebrate] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const toggle = () => {
    if (!done) {
      setCelebrate(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCelebrate(false), 700)
    }
    onToggle?.(task)
  }

  const due = formatDue(task.dueAt)
  const late = !done && isOverdue(task.dueAt)
  const context = task.employer ?? null

  return (
    <li className={`task${done ? ' is-done' : ''}${celebrate ? ' just-done' : ''}${pending ? ' is-pending' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        className="task-check"
        onClick={toggle}
        aria-label={`${done ? 'Mark as not done' : 'Mark as done'}: ${task.title}`}
      >
        <Check aria-hidden="true" />
      </button>
      <div className="task-body">
        <span className="task-title">{task.title}</span>
        {task.detail && <span className="task-detail">{task.detail}</span>}
        {(due || context) && (
          <span className="task-meta">
            {due && <span className={`due${late ? ' late' : ''}`}>{due}</span>}
            {context && <span className="ctx">{context}</span>}
            {task.source === 'user' && <span className="ctx own">Added by you</span>}
          </span>
        )}
      </div>
    </li>
  )
}

export default function TaskList({
  title,
  hint,
  tone = 'due',
  tasks = [],
  onToggle,
  pendingIds,
  collapsible = false,
  defaultOpen = true,
  emptyText,
  id,
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (tasks.length === 0 && !emptyText) return null
  const bodyId = id ? `${id}-body` : undefined

  const head = (
    <>
      <span className={`dot tone-${tone}`} aria-hidden="true" />
      <span className="tl-title">{title}</span>
      <span className="tl-count">{tasks.length}</span>
    </>
  )

  return (
    <section className={`task-group tone-${tone}${open ? '' : ' closed'}`}>
      {collapsible ? (
        <button type="button" className="tl-head as-button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          {head}
          <ChevronDown className="chev" aria-hidden="true" />
        </button>
      ) : (
        <div className="tl-head">{head}</div>
      )}
      {hint && open && <p className="tl-hint">{hint}</p>}
      {open && (
        <ul className="tasks" id={bodyId}>
          {tasks.map((t) => (
            <TaskRow key={t._id} task={t} onToggle={onToggle} pending={pendingIds?.has(t._id)} />
          ))}
          {tasks.length === 0 && emptyText && <li className="task-empty">{emptyText}</li>}
        </ul>
      )}
    </section>
  )
}
