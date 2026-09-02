import { Component, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SignInButton, SignUpButton } from '@clerk/clerk-react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { CalendarDays, ExternalLink, Plus, Search, Sparkles } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import { track } from '../lib/analytics.js'
import { Wordmark } from '../components/Wordmark.jsx'
import TaskList, { daysUntil, formatDate, isOverdue, startOfWeek, DAY } from '../components/TaskList.jsx'
import StageBadge, { STAGES, stageProgress } from '../components/StageBadge.jsx'
import '../styles/timeline.css'

const errorText = (err) => err?.data?.message ?? err?.data ?? err?.message ?? 'Something went wrong'

// The backend may hand back either a bare array of tasks or a { weekOf, tasks }
// envelope. Both are fine here; the page only needs the tasks.
function tasksOf(week) {
  if (!week) return []
  if (Array.isArray(week)) return week
  return Array.isArray(week.tasks) ? week.tasks : []
}

function weekRangeLabel(now = Date.now()) {
  const start = startOfWeek(now)
  const end = start + 6 * DAY
  const f = (ts, opts) => new Date(ts).toLocaleDateString('en-GB', opts)
  const sameMonth = new Date(start).getMonth() === new Date(end).getMonth()
  return `${f(start, { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) })}–${f(end, { day: 'numeric', month: 'short' })}`
}

export default function Timeline() {
  useEffect(() => {
    const prev = document.title
    document.title = 'Your timeline | Get There One Day'
    return () => { document.title = prev }
  }, [])
  if (!backendConfigured) return <NotConfigured />
  return <Gate />
}

function NotConfigured() {
  return (
    <div className="app-gate">
      <Wordmark />
      <h1>Your timeline isn't switched on yet</h1>
      <p>This build has no Clerk or Convex keys, so we can't load your applications. Add them and redeploy.</p>
      <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook instead</Link>
    </div>
  )
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) {
    return (
      <div className="app-page">
        <div className="wrap skel-stack" aria-busy="true" aria-label="Loading your timeline">
          <div className="skel w-40" />
          <div className="skel tall" />
          <div className="skel tall" />
        </div>
      </div>
    )
  }
  if (!isAuthenticated) {
    return (
      <div className="app-gate">
        <div className="eyebrow">Your timeline</div>
        <h1>Never miss a deadline again</h1>
        <p>
          Track every scheme you're going for in one place, and get a short list of what to do
          this week. Most people lose apprenticeship places to a closing date, not to a bad answer.
        </p>
        <ul className="feature-list">
          <li>Every application you're running, with the stage you're at</li>
          <li>A handful of tasks each week, not a wall of them</li>
          <li>Deadlines from schemes we've checked by hand</li>
        </ul>
        <div className="cta-row">
          <SignUpButton mode="modal"><button type="button" className="btn btn-primary">Create a free account</button></SignUpButton>
          <SignInButton mode="modal"><button type="button" className="btn btn-secondary">Sign in</button></SignInButton>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Free, and it stays free. See our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.
        </p>
      </div>
    )
  }
  return <Boundary><Workspace /></Boundary>
}

// Convex throws from useQuery when a function is missing or a query fails, so a
// boundary is the difference between "we couldn't load this" and a white screen.
class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null, key: 0 } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="app-page">
          <div className="wrap">
            <div className="app-error" role="alert">
              <strong>We couldn't load this page.</strong>
              <p>{errorText(this.state.error)}</p>
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>
                  Try again
                </button>
                <Link className="btn btn-ghost btn-sm" to="/charge">Ask Charge instead</Link>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return <div key={this.state.key}>{this.props.children}</div>
  }
}

function Workspace() {
  const ensure = useMutation(api.users.ensure)
  useEffect(() => { ensure() }, [ensure])

  const week = useQuery(api.timeline.myWeek, {})
  const applications = useQuery(api.timeline.myApplications, {})
  const [error, setError] = useState(null)

  const setTaskDone = useMutation(api.timeline.setTaskDone).withOptimisticUpdate((store, args) => {
    const cur = store.getQuery(api.timeline.myWeek, {})
    if (cur === undefined) return
    const patch = (t) => (t._id === args.taskId ? { ...t, doneAt: args.done ? Date.now() : undefined } : t)
    if (Array.isArray(cur)) store.setQuery(api.timeline.myWeek, {}, cur.map(patch))
    else store.setQuery(api.timeline.myWeek, {}, { ...cur, tasks: tasksOf(cur).map(patch) })
  })

  const tasks = useMemo(() => tasksOf(week), [week])
  const buckets = useMemo(() => {
    const byDue = (a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
    return {
      overdue: tasks.filter((t) => !t.doneAt && isOverdue(t.dueAt)).sort(byDue),
      due: tasks.filter((t) => !t.doneAt && !isOverdue(t.dueAt)).sort(byDue),
      done: tasks.filter((t) => t.doneAt).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    }
  }, [tasks])

  const loading = week === undefined || applications === undefined
  const apps = applications ?? []
  const isFirstRun = !loading && apps.length === 0 && tasks.length === 0

  const toggle = async (task) => {
    setError(null)
    const done = !task.doneAt
    try {
      await setTaskDone({ taskId: task._id, done })
      if (done) track('timeline_task_completed', { source: task.source })
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (loading) {
    return (
      <div className="app-page">
        <div className="wrap skel-stack" aria-busy="true" aria-label="Loading your timeline">
          <div className="skel w-40" />
          <div className="skel tall" />
          <div className="skel w-60" />
          <div className="skel tall" />
        </div>
      </div>
    )
  }

  if (isFirstRun) return <FirstRun />

  const total = tasks.length
  const doneCount = buckets.done.length
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100)
  const allDone = total > 0 && doneCount === total

  return (
    <div className="app-page">
      <div className="wrap">
        <div className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">Your timeline</div>
            <h1>This week</h1>
          </div>
          <div className="app-head-actions">
            <Link className="btn btn-secondary btn-sm" to="/answers"><Sparkles size={14} /> Answer bank</Link>
          </div>
        </div>

        <div className="week-hero">
          <div className="week-top">
            <div>
              <div className="week-label">{weekRangeLabel()}</div>
              <h2>{allDone ? 'Week cleared' : buckets.overdue.length > 0 ? 'A couple of things slipped' : 'Here’s the plan'}</h2>
            </div>
            <span className="grow" />
            {total > 0 && (
              <div className="week-progress">
                <div className="bar"><i className={allDone ? 'full' : ''} style={{ width: `${pct}%` }} /></div>
                <div className="lbl">{doneCount} of {total} done</div>
              </div>
            )}
          </div>

          {total === 0 ? (
            <div className="tl-hint" style={{ padding: '18px 18px 20px' }}>
              Nothing scheduled this week. Tasks appear here as your deadlines get closer — or add
              your own below.
            </div>
          ) : (
            <>
              <TaskList
                id="overdue"
                title="Slipped from last week"
                hint="Still worth doing. Move it, or tick it off and forget it."
                tone="overdue"
                tasks={buckets.overdue}
                onToggle={toggle}
              />
              <TaskList
                id="due"
                title="Due this week"
                tone="due"
                tasks={buckets.due}
                onToggle={toggle}
                emptyText={buckets.overdue.length > 0 ? 'Nothing else due this week.' : undefined}
              />
              <TaskList
                id="done"
                title="Done"
                tone="done"
                tasks={buckets.done}
                onToggle={toggle}
                collapsible
                defaultOpen={false}
              />
            </>
          )}

          <AddTask onError={setError} />
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}

        <div className="app-section-head">
          <h2>Your applications</h2>
          <span className="n">{apps.length}</span>
        </div>
        <div className="app-cards">
          {apps.map((a) => <ApplicationCard key={a._id} application={a} onError={setError} />)}
        </div>
        {apps.length === 0 && (
          <div className="app-panel">
            <p className="muted">You aren't tracking any schemes yet. Pick one below and it'll show up here.</p>
          </div>
        )}

        <div className="app-section-head">
          <h2>Track another scheme</h2>
        </div>
        <SchemePicker trackedIds={new Set(apps.map((a) => a.schemeId).filter(Boolean))} />
      </div>
    </div>
  )
}

function AddTask({ onError }) {
  const addTask = useMutation(api.timeline.addTask)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    onError(null)
    try {
      await addTask({ title: t })
      track('timeline_task_added')
      setTitle('')
    } catch (err) {
      onError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="add-task" onSubmit={submit}>
      <label className="sr-only" htmlFor="add-task-input">Add a task to this week</label>
      <input
        id="add-task-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add something of your own…"
      />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={!title.trim() || busy}>
        <Plus size={14} /> Add
      </button>
    </form>
  )
}

function ApplicationCard({ application: a, onError }) {
  const setStage = useMutation(api.timeline.setStage)
  const untrack = useMutation(api.timeline.untrack)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const employer = a.scheme?.employer ?? a.customEmployer ?? 'Employer'
  const name = a.scheme?.name ?? a.customName ?? null
  const deadline = a.deadlineAt ?? a.scheme?.closesAt ?? null
  const left = daysUntil(deadline)
  const progress = stageProgress(a.stage)
  const closed = a.stage === 'rejected' || a.stage === 'withdrawn'

  const change = async (stage) => {
    setBusy(true)
    onError(null)
    try {
      await setStage({ applicationId: a._id, stage })
      track('timeline_stage_changed', { stage })
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`app-card${closed ? ' is-closed' : ''}`}>
      <div className="ac-top">
        <div className="ac-name">
          <div className="ac-employer">{employer}</div>
          {name && <div className="ac-scheme">{name}</div>}
        </div>
        <StageBadge stage={a.stage} size="sm" />
      </div>

      {progress !== null && <div className="ac-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}

      <div className="ac-meta">
        {deadline ? (
          <span className={left !== null && left <= 7 && left >= 0 ? 'soon' : undefined}>
            <CalendarDays size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {left === null ? formatDate(deadline)
              : left < 0 ? `Closed ${formatDate(deadline)}`
              : left === 0 ? 'Closes today'
              : left === 1 ? 'Closes tomorrow'
              : `Closes in ${left} days`}
          </span>
        ) : a.scheme?.rolling ? (
          <span>Rolling deadline — apply early</span>
        ) : (
          <span>No published deadline</span>
        )}
        {a.scheme?.url && (
          <a href={a.scheme.url} target="_blank" rel="noopener">Employer page <ExternalLink /></a>
        )}
      </div>

      <div className="ac-actions">
        <select
          id={`stage-${a._id}`}
          value={a.stage}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
          aria-label={`Stage for ${employer}`}
        >
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {confirm ? (
          <button
            type="button" className="link-btn danger"
            onClick={async () => {
              try { await untrack({ applicationId: a._id }) } catch (e) { onError(errorText(e)) }
              setConfirm(false)
            }}
          >
            Stop tracking?
          </button>
        ) : (
          <button type="button" className="link-btn" onClick={() => setConfirm(true)}>Remove</button>
        )}
      </div>
    </article>
  )
}

function SchemePicker({ trackedIds, autoFocus = false }) {
  const [q, setQ] = useState('')
  const schemes = useQuery(api.timeline.listSchemes, { q: q.trim() || undefined, limit: 12 })
  const trackScheme = useMutation(api.timeline.trackScheme)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const add = async (scheme) => {
    setBusyId(scheme._id)
    setError(null)
    try {
      await trackScheme({ schemeId: scheme._id })
      track('timeline_scheme_tracked', { slug: scheme.slug })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="scheme-picker">
      <div className="scheme-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employers and schemes…"
          aria-label="Search employers and schemes"
        />
      </div>

      {schemes === undefined ? (
        <div className="skel-stack" aria-busy="true" aria-label="Loading schemes">
          <div className="skel tall" /><div className="skel tall" />
        </div>
      ) : schemes.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.92rem' }}>
          {q.trim()
            ? <>Nothing matching “{q.trim()}”. Every scheme here is checked by hand, so the list is deliberately short — add it yourself below.</>
            : <>No schemes loaded yet. You can still add one yourself below.</>}
        </p>
      ) : (
        <ul className="scheme-list">
          {schemes.map((s) => {
            const tracked = trackedIds?.has(s._id)
            const left = daysUntil(s.closesAt)
            return (
              <li className={`scheme${tracked ? ' tracked' : ''}`} key={s._id}>
                <div className="s-body">
                  <span className="s-employer">{s.employer}</span>
                  <span className="s-name">{s.name}</span>
                  <span className="s-meta">
                    {s.level ? <span>Level {s.level}</span> : null}
                    {s.sector ? <span>{s.sector}</span> : null}
                    {s.rolling ? <span>Rolling</span> : left !== null && left >= 0 ? <span className={left <= 14 ? 'closes' : undefined}>Closes in {left} days</span> : null}
                  </span>
                </div>
                {tracked ? (
                  <span className="stage-badge tone-live sm"><i aria-hidden="true" />Tracking</span>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busyId === s._id} onClick={() => add(s)}>
                    {busyId === s._id ? 'Adding…' : 'Track'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <CustomTrack onError={setError} />
    </div>
  )
}

function CustomTrack({ onError }) {
  const trackScheme = useMutation(api.timeline.trackScheme)
  const [employer, setEmployer] = useState('')
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!employer.trim() || busy) return
    setBusy(true)
    onError?.(null)
    try {
      await trackScheme({
        customEmployer: employer.trim(),
        customName: name.trim() || undefined,
        deadlineAt: deadline ? new Date(`${deadline}T23:59:59`).getTime() : undefined,
      })
      track('timeline_custom_tracked')
      setEmployer(''); setName(''); setDeadline(''); setSaved(true)
    } catch (err) {
      onError?.(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="custom-track">
      <summary>Applying somewhere that isn't listed? Add it yourself.</summary>
      <form onSubmit={submit}>
        <div className="field-row two">
          <div className="field">
            <label htmlFor="ct-employer">Employer</label>
            <input id="ct-employer" value={employer} onChange={(e) => setEmployer(e.target.value)} placeholder="e.g. Rolls-Royce" required />
          </div>
          <div className="field">
            <label htmlFor="ct-name">Scheme (optional)</label>
            <input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Degree Apprenticeship, Engineering" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ct-deadline">Closing date (optional)</label>
          <input id="ct-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="cta-row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!employer.trim() || busy}>
            {busy ? 'Adding…' : 'Add to my timeline'}
          </button>
          {saved && <span className="inline-note" role="status">Added.</span>}
        </div>
      </form>
    </details>
  )
}

function FirstRun() {
  return (
    <div className="app-page">
      <div className="wrap first-run">
        <div className="first-run-intro">
          <div className="eyebrow">Your timeline</div>
          <h2>Pick one scheme. That's the whole first step.</h2>
          <p>
            Most people don't miss out because their answers weren't good enough. They miss out
            because a closing date went past while they were still thinking about it. Track a
            scheme and we'll break it into a few things to do each week.
          </p>
          <ol className="first-run-steps">
            <li><span className="n">1</span> Track a scheme you're actually interested in.</li>
            <li><span className="n">2</span> We turn its deadline into a short weekly list.</li>
            <li><span className="n">3</span> You tick things off. That's it.</li>
          </ol>
        </div>

        <div>
          <div className="app-section-head" style={{ marginTop: 0 }}>
            <h2>Start here</h2>
            <span className="n">One click</span>
          </div>
          <SchemePicker trackedIds={new Set()} autoFocus />
        </div>

        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Not sure which to go for? <Link to="/charge" style={{ color: 'var(--teal)', fontWeight: 600 }}>Ask Charge</Link> or
          read the <Link to="/apprenticeships" style={{ color: 'var(--teal)', fontWeight: 600 }}>playbook</Link> first.
        </p>
      </div>
    </div>
  )
}
