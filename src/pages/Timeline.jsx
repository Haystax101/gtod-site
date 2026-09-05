import { Component, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SignInButton, SignUpButton } from '@clerk/clerk-react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { CalendarDays, ExternalLink, Plus, Search, Sparkles } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import { track } from '../lib/analytics.js'
import { Wordmark } from '../components/Wordmark.jsx'
import AppNav from '../components/AppNav.jsx'
import TaskList, { formatDate, startOfWeek, DAY } from '../components/TaskList.jsx'
import StageBadge, { STAGES, stageProgress } from '../components/StageBadge.jsx'
import '../styles/timeline.css'

const errorText = (err) => err?.data?.message ?? err?.data ?? err?.message ?? 'Something went wrong'

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

function LoadingPage({ label }) {
  return (
    <div className="app-page">
      <div className="wrap skel-stack" aria-busy="true" aria-label={label}>
        <div className="skel w-40" />
        <div className="skel tall" />
        <div className="skel w-60" />
        <div className="skel tall" />
      </div>
    </div>
  )
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) return <LoadingPage label="Loading your timeline" />
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
          <li>Deadlines from schemes a human has checked by hand</li>
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

// Convex throws from useQuery when a query fails, so a boundary is the
// difference between "we couldn't load this" and a white screen.
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

  // The tick has to land before the round trip: the reward for doing the thing
  // is seeing it move, and a 300ms wait is long enough to feel like a bug.
  const completeTask = useMutation(api.timeline.completeTask).withOptimisticUpdate((store, { taskId, done }) => {
    const cur = store.getQuery(api.timeline.myWeek, {})
    if (!cur) return
    const found = [...cur.overdue, ...cur.dueThisWeek, ...cur.done].find((t) => t._id === taskId)
    if (!found) return
    const drop = (list) => list.filter((t) => t._id !== taskId)
    const next = { ...cur, overdue: drop(cur.overdue), dueThisWeek: drop(cur.dueThisWeek), done: drop(cur.done) }
    if (done) {
      next.done = [{ ...found, doneAt: Date.now() }, ...next.done]
    } else {
      const revived = { ...found, doneAt: undefined }
      if (revived.dueAt !== undefined && revived.dueAt < Date.now()) next.overdue = [...next.overdue, revived]
      else next.dueThisWeek = [...next.dueThisWeek, revived]
    }
    next.remaining = next.overdue.length + next.dueThisWeek.length
    store.setQuery(api.timeline.myWeek, {}, next)
  })

  if (week === undefined || applications === undefined) return <LoadingPage label="Loading your timeline" />

  const apps = applications ?? []
  const overdue = week.overdue ?? []
  const dueThisWeek = week.dueThisWeek ?? []
  const done = week.done ?? []
  const total = overdue.length + dueThisWeek.length + done.length

  if (apps.length === 0 && total === 0) return <FirstRun />

  const toggle = async (task) => {
    setError(null)
    const done = !task.doneAt
    try {
      await completeTask({ taskId: task._id, done })
      if (done) track('timeline_task_completed', { source: task.source })
    } catch (e) {
      setError(errorText(e))
    }
  }

  const pct = total === 0 ? 0 : Math.round((done.length / total) * 100)
  const allDone = total > 0 && done.length === total

  return (
    <div className="app-page">
      <div className="wrap">
        <AppNav />
        <div className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">Your timeline</div>
            <h1>This week</h1>
          </div>
          <div className="app-head-actions">
            
          </div>
        </div>

        <div className="week-hero">
          <div className="week-top">
            <div>
              <div className="week-label">{weekRangeLabel()}</div>
              <h2>{allDone ? 'Week cleared' : overdue.length > 0 ? 'A couple of things slipped' : 'Here’s the plan'}</h2>
            </div>
            <span className="grow" />
            {total > 0 && (
              <div className="week-progress">
                <div className="bar"><i className={allDone ? 'full' : ''} style={{ width: `${pct}%` }} /></div>
                <div className="lbl">{done.length} of {total} done</div>
              </div>
            )}
          </div>

          {total === 0 ? (
            <p className="tl-hint" style={{ padding: '18px 18px 20px' }}>
              Nothing scheduled this week. Tasks appear here as your deadlines get closer — or add
              your own below.
            </p>
          ) : (
            <>
              <TaskList
                id="overdue"
                title="Slipped from last week"
                hint="Still worth doing. Tick it off, and it's gone."
                tone="overdue"
                tasks={overdue}
                onToggle={toggle}
              />
              <TaskList
                id="due"
                title="Due this week"
                tone="due"
                tasks={dueThisWeek}
                onToggle={toggle}
                emptyText={overdue.length > 0 ? 'Nothing else due this week.' : undefined}
              />
              <TaskList
                id="done"
                title="Done"
                tone="done"
                tasks={done}
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
        {apps.length === 0 ? (
          <div className="app-panel">
            <p className="muted">You aren't tracking any schemes yet. Pick one below and it'll show up here.</p>
          </div>
        ) : (
          <div className="app-cards">
            {apps.map((a) => <ApplicationCard key={a._id} application={a} onError={setError} />)}
          </div>
        )}

        <div className="app-section-head">
          <h2>Track another scheme</h2>
        </div>
        <SchemePicker />
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
      <input id="add-task-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add something of your own…" />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={!title.trim() || busy}>
        <Plus size={14} /> Add
      </button>
    </form>
  )
}

function deadlineCopy(a) {
  if (a.deadlineAt === undefined) return 'No confirmed deadline'
  const left = a.daysUntilDeadline
  if (left === undefined) return formatDate(a.deadlineAt)
  if (left < 0) return `Closed ${formatDate(a.deadlineAt)}`
  if (left === 0) return 'Closes today'
  if (left === 1) return 'Closes tomorrow'
  return `Closes in ${left} days`
}

function ApplicationCard({ application: a, onError }) {
  const updateStage = useMutation(api.timeline.updateStage)
  const untrackScheme = useMutation(api.timeline.untrackScheme)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const progress = stageProgress(a.stage)
  const closed = a.stage === 'rejected' || a.stage === 'withdrawn'
  const soon = a.daysUntilDeadline !== undefined && a.daysUntilDeadline >= 0 && a.daysUntilDeadline <= 7

  const change = async (stage) => {
    setBusy(true)
    onError(null)
    try {
      await updateStage({ applicationId: a._id, stage })
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
          <div className="ac-employer">{a.employer}</div>
          {a.name && <div className="ac-scheme">{a.name}</div>}
        </div>
        <StageBadge stage={a.stage} size="sm" />
      </div>

      {progress !== null && <div className="ac-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}

      <div className="ac-meta">
        <span className={soon ? 'soon' : undefined}>
          <CalendarDays size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          {deadlineCopy(a)}
        </span>
        {a.openTasksThisWeek > 0 && <span>{a.openTasksThisWeek} to do this week</span>}
        {a.url && <a href={a.url} target="_blank" rel="noopener">Employer page <ExternalLink /></a>}
      </div>

      <div className="ac-actions">
        <select
          value={a.stage}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
          aria-label={`Stage for ${a.employer}`}
        >
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {confirm ? (
          <button
            type="button" className="link-btn danger"
            onClick={async () => {
              try { await untrackScheme({ applicationId: a._id }) } catch (e) { onError(errorText(e)) }
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

function SchemePicker() {
  const [q, setQ] = useState('')
  const result = useQuery(api.timeline.listSchemes, { search: q.trim() || undefined, limit: 12 })
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

  const schemes = result?.schemes ?? []

  return (
    <div className="scheme-picker">
      <div className="scheme-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employers and schemes…"
          aria-label="Search employers and schemes"
        />
      </div>

      {result === undefined ? (
        <div className="skel-stack" aria-busy="true" aria-label="Loading schemes">
          <div className="skel tall" /><div className="skel tall" />
        </div>
      ) : schemes.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.92rem' }}>
          {q.trim()
            ? <>Nothing matching “{q.trim()}”. Every scheme here is checked by hand, so the list is deliberately short — add yours below.</>
            : <>No schemes loaded yet. You can still add one yourself below.</>}
        </p>
      ) : (
        <ul className="scheme-list">
          {schemes.map((s) => {
            const tracked = Boolean(s.trackedApplicationId)
            return (
              <li className={`scheme${tracked ? ' tracked' : ''}`} key={s._id}>
                <div className="s-body">
                  <span className="s-employer">{s.employer}</span>
                  <span className="s-name">{s.name}</span>
                  <span className="s-meta">
                    {s.level ? <span>Level {s.level}</span> : null}
                    {s.sector ? <span>{s.sector}</span> : null}
                    {s.rolling
                      ? <span>Rolling</span>
                      : s.closesAt ? <span className="closes">Closes {formatDate(s.closesAt)}</span> : <span>Dates not confirmed</span>}
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
      {result !== undefined && result.total > schemes.length && (
        <p className="inline-note">Showing {schemes.length} of {result.total}. Search to narrow it down.</p>
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
            <input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering Degree Apprenticeship" />
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
            scheme and we'll turn it into a few things to do each week — starting straight away,
            not next Monday.
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
          <SchemePicker />
        </div>

        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Not sure which to go for? <Link to="/charge" style={{ color: 'var(--teal)', fontWeight: 600 }}>Ask Charge</Link> or
          read the <Link to="/apprenticeships" style={{ color: 'var(--teal)', fontWeight: 600 }}>playbook</Link> first.
        </p>
      </div>
    </div>
  )
}
