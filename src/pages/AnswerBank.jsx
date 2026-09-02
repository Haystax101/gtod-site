import { Component, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SignInButton, SignUpButton } from '@clerk/clerk-react'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { ArrowLeft, Check, Copy, Plus, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import { track } from '../lib/analytics.js'
import { Wordmark, ChargeMark } from '../components/Wordmark.jsx'
import { formatDate } from '../components/TaskList.jsx'
import '../styles/timeline.css'
import '../styles/coach.css'

const errorText = (err) => err?.data?.message ?? err?.data ?? err?.message ?? 'Something went wrong'
const isLimit = (msg) => typeof msg === 'string' && msg.startsWith('LIMIT:')
const stripLimit = (msg) => (isLimit(msg) ? msg.slice(6) : msg)

// The competencies degree apprenticeship employers actually assess against,
// with the question they usually arrive as.
const COMPETENCIES = [
  { id: 'Teamwork', prompt: 'Tell me about a time you worked well in a team.' },
  { id: 'Resilience', prompt: 'Tell me about a time you had to show resilience or overcome a challenge.' },
  { id: 'Problem solving', prompt: 'Describe a problem you solved that other people had struggled with.' },
  { id: 'Leadership', prompt: 'Tell me about a time you took the lead on something.' },
  { id: 'Communication', prompt: 'Give me an example of when you had to explain something complicated to someone.' },
  { id: 'Adaptability', prompt: 'Tell me about a time you had to change your approach.' },
  { id: 'Time management', prompt: 'How do you handle several deadlines at once? Give me an example.' },
  { id: 'Why this firm', prompt: 'Why did you apply to this firm over others in the industry?' },
  { id: 'Why an apprenticeship', prompt: 'Why a degree apprenticeship rather than a traditional degree?' },
]

const STAR_STEPS = [
  { k: 'S', t: 'Situation', d: 'Where were you and what was going on? Two sentences, no more.', eg: '“In my Saturday job the rota kept leaving the tills short at closing.”' },
  { k: 'T', t: 'Task', d: 'What was your responsibility specifically? Not the group’s — yours.', eg: '“I was the one cashing up, so it landed on me.”' },
  { k: 'A', t: 'Action', d: 'What did you actually do, step by step? Say “I”, not “we”.', eg: '“I logged two weeks of closing times and took a new rota to my manager.”' },
]

const RESULT_STEP = {
  k: 'R', t: 'Result', d: 'What changed because of you? Put a number on it if you can, and say what you learned.',
  eg: '“Closing dropped from 40 minutes to 25, and my manager rolled it out to the other store.”',
}

// A quick self-check, not a grade. It tells you what's missing, which is almost
// always the Result.
function starCheck(body = '') {
  const text = body.trim()
  const lower = text.toLowerCase()
  return {
    s: text.length > 80,
    t: /\b(i had to|my job|my role|responsible|asked me|i needed to|it was on me|i was the)\b/.test(lower),
    a: (lower.match(/\bi\s+\w+/g) || []).length >= 3,
    r: /\d/.test(text) || /\b(as a result|resulted in|meant that|ended up|we won|increased|reduced|saved|improved|grew|cut|went from|learned|learnt|feedback)\b/.test(lower),
  }
}

export default function AnswerBank() {
  useEffect(() => {
    const prev = document.title
    document.title = 'Your answer bank | Get There One Day'
    return () => { document.title = prev }
  }, [])
  if (!backendConfigured) return <NotConfigured />
  return <Gate />
}

function NotConfigured() {
  return (
    <div className="app-gate">
      <Wordmark />
      <h1>The answer bank isn't switched on yet</h1>
      <p>This build has no Clerk or Convex keys, so we can't load your answers. Add them and redeploy.</p>
      <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook instead</Link>
    </div>
  )
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) {
    return (
      <div className="app-page"><div className="wrap skel-stack" aria-busy="true" aria-label="Loading your answers">
        <div className="skel w-40" /><div className="skel tall" /><div className="skel tall" />
      </div></div>
    )
  }
  if (!isAuthenticated) {
    return (
      <div className="app-gate">
        <div className="eyebrow">Answer bank</div>
        <h1>Write it once. Use it fifteen times.</h1>
        <p>
          Every employer asks the same handful of competency questions in slightly different words.
          Bank a strong answer to each one, get it critiqued, and stop starting from a blank page
          at 11pm the night before a deadline.
        </p>
        <ul className="feature-list">
          <li>Your answers grouped by competency, ready to adapt</li>
          <li>A STAR structure guide that keeps you honest about the Result</li>
          <li>Charge critiques it — strengths first, then what to fix</li>
        </ul>
        <div className="cta-row">
          <SignUpButton mode="modal"><button type="button" className="btn btn-primary">Create a free account</button></SignUpButton>
          <SignInButton mode="modal"><button type="button" className="btn btn-secondary">Sign in</button></SignInButton>
        </div>
      </div>
    )
  }
  return <Boundary><Workspace /></Boundary>
}

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null, key: 0 } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="app-page"><div className="wrap">
          <div className="app-error" role="alert">
            <strong>We couldn't load your answer bank.</strong>
            <p>{errorText(this.state.error)}</p>
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>Try again</button>
              <Link className="btn btn-ghost btn-sm" to="/charge">Ask Charge instead</Link>
            </div>
          </div>
        </div></div>
      )
    }
    return <div key={this.state.key}>{this.props.children}</div>
  }
}

function Workspace() {
  const ensure = useMutation(api.users.ensure)
  useEffect(() => { ensure() }, [ensure])

  const answers = useQuery(api.coach.myAnswers, {})
  const [selected, setSelected] = useState(null) // answer _id, or 'new'
  const [seed, setSeed] = useState(null) // { competency, prompt } for a new answer

  const grouped = useMemo(() => {
    const map = new Map()
    for (const a of answers ?? []) {
      const key = a.competency || 'Uncategorised'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(a)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [answers])

  const startNew = (competency = '', prompt = '') => {
    setSeed({ competency, prompt })
    setSelected('new')
    track('answer_new_started', { competency: competency || null })
  }

  if (answers === undefined) {
    return (
      <div className="app-page"><div className="wrap skel-stack" aria-busy="true" aria-label="Loading your answers">
        <div className="skel w-40" /><div className="skel tall" /><div className="skel tall" /><div className="skel tall" />
      </div></div>
    )
  }

  const active = selected === 'new' ? null : (answers.find((a) => a._id === selected) ?? null)
  const editing = selected !== null

  return (
    <div className="app-page">
      <div className="wrap">
        <div className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">Answer bank</div>
            <h1>Your answers</h1>
            <p>Written once, adapted for every application. Charge critiques them; it doesn't write them for you.</p>
          </div>
          <div className="app-head-actions">
            <Link className="btn btn-secondary btn-sm" to="/timeline">Timeline</Link>
          </div>
        </div>

        {answers.length === 0 && selected === null ? (
          <EmptyBank onStart={startNew} />
        ) : (
          <div className={`bank${editing ? ' editing' : ''}`}>
            <div className="bank-list">
              <button type="button" className="btn btn-primary btn-sm new-answer" onClick={() => startNew()}>
                <Plus size={14} /> New answer
              </button>
              {grouped.map(([competency, list]) => (
                <div className="bank-group" key={competency}>
                  <div className="g-head">{competency} <span className="n">{list.length}</span></div>
                  {list.map((a) => {
                    const check = starCheck(a.body)
                    const complete = a.starComplete ?? (check.s && check.a && check.r)
                    return (
                      <button
                        type="button" key={a._id} className="answer-chip"
                        aria-current={a._id === selected}
                        onClick={() => { setSeed(null); setSelected(a._id) }}
                      >
                        <span className="a-prompt">{a.prompt || 'Untitled answer'}</span>
                        <span className="a-meta">
                          <span>{a.body ? `${a.body.trim().split(/\s+/).length} words` : 'Empty'}</span>
                          {complete ? <span className="ok">STAR complete</span> : <span className="flag">No result yet</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {answers.length === 0 && <p className="muted" style={{ fontSize: '0.9rem', padding: '4px' }}>Nothing banked yet.</p>}
            </div>

            <div className="bank-editor">
              {selected === null ? (
                <div className="app-panel">
                  <p className="muted">Pick an answer on the left, or start a new one.</p>
                </div>
              ) : (
                <Editor
                  key={selected}
                  answer={active}
                  seed={seed}
                  isNew={selected === 'new'}
                  onClose={() => { setSelected(null); setSeed(null) }}
                  onCreated={(id) => { setSelected(id); setSeed(null) }}
                  onDeleted={() => { setSelected(null); setSeed(null) }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyBank({ onStart }) {
  return (
    <div className="bank-empty">
      <h2>Nine questions cover almost every interview you'll sit.</h2>
      <p>
        Employers dress them up differently, but underneath it's the same short list. Write one
        properly and you'll reuse it for the rest of the season. Start with whichever you've
        actually got a story for.
      </p>
      <div className="starter-list">
        {COMPETENCIES.slice(0, 5).map((c) => (
          <button type="button" className="starter" key={c.id} onClick={() => onStart(c.id, c.prompt)}>
            <span className="c">{c.id}</span>
            <span className="q">{c.prompt}</span>
          </button>
        ))}
      </div>
      <div className="cta-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart()}>
          <Plus size={14} /> Or write your own
        </button>
      </div>
    </div>
  )
}

function Editor({ answer, seed, isNew, onClose, onCreated, onDeleted }) {
  const saveAnswer = useMutation(api.coach.saveAnswer)
  const deleteAnswer = useMutation(api.coach.deleteAnswer)
  const requestCritique = useAction(api.coach.requestCritique)

  const [competency, setCompetency] = useState(answer?.competency ?? seed?.competency ?? '')
  const [prompt, setPrompt] = useState(answer?.prompt ?? seed?.prompt ?? '')
  const [body, setBody] = useState(answer?.body ?? '')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [critiquing, setCritiquing] = useState(false)

  const answerId = answer?._id ?? null
  const critiques = useQuery(api.coach.critiquesFor, answerId ? { answerId } : 'skip')

  // Answers already banked that this one could be adapted from. Only worth
  // showing while the page is still blank.
  const showAdapt = isNew && competency.trim().length > 0 && body.trim().length < 40
  const similar = useQuery(
    api.coach.similarAnswers,
    showAdapt ? { competency: competency.trim(), prompt: prompt.trim() || undefined, limit: 3 } : 'skip',
  )

  const check = starCheck(body)
  const words = body.trim() ? body.trim().split(/\s+/).length : 0

  const save = async () => {
    if (busy) return null
    setBusy(true)
    setError(null)
    try {
      const id = await saveAnswer({
        answerId: answerId ?? undefined,
        competency: competency.trim() || 'Uncategorised',
        prompt: prompt.trim(),
        body,
      })
      setDirty(false)
      setSavedAt(Date.now())
      track('answer_saved', { competency: competency.trim() || null, words })
      if (!answerId && id) onCreated(id)
      return id ?? answerId
    } catch (e) {
      setError(errorText(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const getFeedback = async () => {
    setError(null)
    let id = answerId
    if (!id || dirty) id = await save()
    if (!id) return
    setCritiquing(true)
    try {
      await requestCritique({ answerId: id })
      track('answer_critique_requested')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setCritiquing(false)
    }
  }

  const latest = Array.isArray(critiques) ? critiques[0] : null

  return (
    <>
      <div className="editor-top">
        <button type="button" className="btn btn-ghost btn-sm back" onClick={onClose}>
          <ArrowLeft size={15} /> All answers
        </button>
        <span className="grow" />
        {answerId && (
          <button
            type="button" className="link-btn danger"
            onClick={async () => {
              if (!window.confirm('Delete this answer? It cannot be undone.')) return
              try { await deleteAnswer({ answerId }); onDeleted() } catch (e) { setError(errorText(e)) }
            }}
          >
            <Trash2 size={13} style={{ verticalAlign: '-2px' }} /> Delete
          </button>
        )}
      </div>

      <div className="editor-card">
        <div className="field-row two">
          <div className="field">
            <label htmlFor="ed-competency">Competency</label>
            <input
              id="ed-competency" list="competency-options" value={competency}
              onChange={(e) => { setCompetency(e.target.value); setDirty(true) }}
              placeholder="e.g. Teamwork"
            />
            <datalist id="competency-options">
              {COMPETENCIES.map((c) => <option key={c.id} value={c.id} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="ed-prompt">The question</label>
            <input
              id="ed-prompt" value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setDirty(true) }}
              placeholder="Tell me about a time you…"
            />
          </div>
        </div>

        {showAdapt && Array.isArray(similar) && similar.length > 0 && (
          <div className="adapt-panel">
            <h4>You've written something close to this already</h4>
            <p>Adapting beats starting again. Pull one in and rework it for this question.</p>
            <div className="adapt-list">
              {similar.map((s) => (
                <div className="adapt-item" key={s._id}>
                  <span className="a-prompt">{s.prompt || 'Untitled answer'}</span>
                  <span className="a-snip">{s.body}</span>
                  <div className="row">
                    <span className="tag">{s.competency}</span>
                    <span className="grow" />
                    <button
                      type="button" className="btn btn-secondary btn-sm"
                      onClick={() => { setBody(s.body); setDirty(true); track('answer_adapted') }}
                    >
                      <Copy size={13} /> Adapt this
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <StarGuide check={check} />

        <div className="field">
          <label htmlFor="ed-body">Your answer</label>
          <textarea
            id="ed-body" className="body-area" value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true) }}
            placeholder="Situation… Task… Action… Result. Write it how you'd say it out loud."
          />
        </div>

        <div className="star-meter" aria-label="Quick STAR check">
          <span className={`pip${check.s ? ' on' : ''}`} title="Situation">S</span>
          <span className={`pip${check.t ? ' on' : ''}`} title="Task">T</span>
          <span className={`pip${check.a ? ' on' : ''}`} title="Action">A</span>
          <span className={`pip${check.r ? ' on' : ' missing-result'}`} title="Result">R</span>
          <span>
            {check.r
              ? `${words} words. Quick check only — Charge will be harder on it.`
              : 'No result yet. What actually changed because of you?'}
          </span>
        </div>

        <div className="save-row">
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || (!dirty && Boolean(answerId))}>
            {busy ? 'Saving…' : answerId ? 'Save changes' : 'Save to bank'}
          </button>
          <button type="button" className="btn btn-accent btn-sm" onClick={getFeedback} disabled={critiquing || body.trim().length < 40}>
            <Sparkles size={14} /> {critiquing ? 'Charge is reading…' : 'Get feedback'}
          </button>
          <span className="grow" />
          {dirty ? (
            <span className="saved-note">Unsaved changes</span>
          ) : savedAt ? (
            <span className="saved-note" role="status">Saved</span>
          ) : answer?.updatedAt ? (
            <span className="saved-note">Last saved {formatDate(answer.updatedAt)}</span>
          ) : null}
        </div>
        {body.trim().length > 0 && body.trim().length < 40 && (
          <p className="inline-note">Write a bit more before asking for feedback — about a paragraph is enough.</p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {stripLimit(error)}{' '}
            {isLimit(error) && <Link to="/charge" style={{ color: 'var(--orange)', fontWeight: 600 }}>See Pro</Link>}
          </p>
        )}
      </div>

      <Critique critique={latest} loading={critiquing} hasAnswer={Boolean(answerId)} />
    </>
  )
}

function StarGuide({ check }) {
  return (
    <details className="star-guide" open={!check.r}>
      <summary>STAR structure — what a good answer actually contains</summary>
      <ul className="star-steps">
        {STAR_STEPS.map((s) => (
          <li className="star-step" key={s.k}>
            <span className="k" aria-hidden="true">{s.k}</span>
            <span>
              <span className="t">{s.t}</span>
              <span className="d"> — {s.d}</span>
              <span className="eg">{s.eg}</span>
            </span>
          </li>
        ))}
        <li className="star-step result">
          <span className="k" aria-hidden="true">{RESULT_STEP.k}</span>
          <span>
            <span className="t">{RESULT_STEP.t}</span>
            <span className="d"> — {RESULT_STEP.d}</span>
            <span className="eg">{RESULT_STEP.eg}</span>
            <span className="flag">This is the part almost everyone leaves out. It's the part that gets you through.</span>
          </span>
        </li>
      </ul>
    </details>
  )
}

function Critique({ critique, loading, hasAnswer }) {
  if (loading) {
    return (
      <div className="critique">
        <div className="critique-head"><ChargeMark /><h3>Charge is reading your answer</h3></div>
        <div className="critique-body skel-stack" aria-busy="true">
          <div className="skel w-80" /><div className="skel w-60" /><div className="skel w-40" />
        </div>
      </div>
    )
  }
  if (!critique) {
    return (
      <div className="critique">
        <div className="critique-head"><ChargeMark /><h3>Feedback</h3></div>
        <p className="crit-empty">
          {hasAnswer
            ? 'No feedback yet. Hit “Get feedback” and Charge will go through it: what works, then what to fix, in the order worth fixing it.'
            : 'Save the answer first, then Charge can go through it with you.'}
        </p>
      </div>
    )
  }
  const strengths = critique.strengths ?? []
  const fixes = critique.fixes ?? []
  return (
    <div className="critique">
      <div className="critique-head">
        <ChargeMark />
        <h3>Charge's read on this</h3>
        <span className="when">{formatDate(critique.createdAt)}</span>
      </div>
      <div className="critique-body">
        {critique.body && <p className="critique-note">{critique.body}</p>}
        {strengths.length > 0 && (
          <div className="crit-block strengths">
            <h4><Check size={13} /> What's working</h4>
            <ul>
              {strengths.map((s, i) => <li key={i}><Check aria-hidden="true" /><span>{s}</span></li>)}
            </ul>
          </div>
        )}
        {fixes.length > 0 && (
          <div className="crit-block fixes">
            <h4>Fix these, in this order</h4>
            <ul>
              {fixes.map((f, i) => (
                <li key={i}><span className="rank" aria-hidden="true">{i + 1}</span><span>{f}</span></li>
              ))}
            </ul>
          </div>
        )}
        {strengths.length === 0 && fixes.length === 0 && !critique.body && (
          <p className="crit-empty">Charge didn't return anything useful this time. Try again in a moment.</p>
        )}
      </div>
      <p className="coach-disclaimer">
        Charge coaches, it doesn't ghost-write. Rewrite it in your own words — an interviewer will
        ask follow-up questions about the story, and it has to be yours.
      </p>
    </div>
  )
}
