import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { SignInButton, SignUpButton } from '@clerk/clerk-react'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { Check, FileText, Menu, Paperclip, Plus, Send, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import { renderMarkdown } from '../lib/markdown.js'
import { extractText } from '../lib/extractText.js'
import { track } from '../lib/analytics.js'
import { Wordmark, ChargeMark } from '../components/Wordmark.jsx'
import '../styles/charge.css'

const SUGGESTIONS = [
  'How do I tailor my CV to a specific apprenticeship?',
  "What should I say when they ask 'why us over other firms'?",
  "I've got an assessment centre next week. What should I focus on?",
  'Where can I find work experience if I have no contacts?',
]

const errorText = (err) => err?.data?.message ?? err?.data ?? err?.message ?? 'Something went wrong'
const isLimit = (msg) => typeof msg === 'string' && msg.startsWith('LIMIT:')
const stripLimit = (msg) => (isLimit(msg) ? msg.slice(6) : msg)

export default function Charge() {
  useEffect(() => {
    const prev = document.title
    document.title = 'Charge, the GTOD apprenticeship assistant | Get There One Day'
    return () => { document.title = prev }
  }, [])
  if (!backendConfigured) return <NotConfigured />
  return <Gate />
}

function NotConfigured() {
  return (
    <div className="gate">
      <Wordmark />
      <h2>Charge isn't switched on yet</h2>
      <p>This build has no Clerk or Convex keys, so the assistant can't run. Add them and redeploy.</p>
      <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook instead</Link>
    </div>
  )
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) return <div className="gate"><div className="spinner" /></div>
  if (!isAuthenticated) {
    return (
      <div className="gate">
        <Wordmark />
        <h2>Chat to us about your apprenticeship application</h2>
        <p>
          Charge knows everything in the GTOD playbook and coaches you through it: CVs, cover letters,
          assessment centres, interviews. Upload your CV for honest feedback. Free to start.
        </p>
        <ul className="feature-list">
          <li>Advice grounded in what actually worked for us</li>
          <li>Upload a CV or cover letter for specific feedback</li>
          <li>Coaches you rather than writing it for you</li>
        </ul>
        <div className="cta-row">
          <SignUpButton mode="modal"><button type="button" className="btn btn-primary">Create a free account</button></SignUpButton>
          <SignInButton mode="modal"><button type="button" className="btn btn-secondary">Sign in</button></SignInButton>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          By continuing you agree to our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>. 18+ or with a parent's permission.
        </p>
      </div>
    )
  }
  return <Workspace />
}

function Workspace() {
  const ensure = useMutation(api.users.ensure)
  const me = useQuery(api.users.me)
  const conversations = useQuery(api.conversations.list) ?? []
  const [activeId, setActiveId] = useState(null)
  const [sideOpen, setSideOpen] = useState(false)
  const [showPlans, setShowPlans] = useState(false)
  const [toast, setToast] = useState(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => { ensure() }, [ensure])

  // Back from Stripe checkout
  useEffect(() => {
    if (new URLSearchParams(location.search).has('upgraded')) {
      setToast('Payment received. Pro unlocks as soon as Stripe confirms, usually within a few seconds.')
      track('pro_checkout_completed')
      navigate('/charge', { replace: true })
    }
  }, [location.search, navigate])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const active = conversations.find((c) => c._id === activeId) ?? null

  return (
    <div className="charge-shell">
      {sideOpen && <div className="side-backdrop" onClick={() => setSideOpen(false)} />}
      <aside className={`charge-side${sideOpen ? ' open' : ''}`}>
        <div className="side-top">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setActiveId(null); setSideOpen(false) }}>
            <Plus size={16} /> New chat
          </button>
        </div>
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => { setActiveId(id); setSideOpen(false) }}
          onDeleted={(id) => { if (id === activeId) setActiveId(null) }}
        />
        <PlanCard me={me} onUpgrade={() => setShowPlans(true)} />
      </aside>

      <main className="charge-main">
        <div className="charge-top">
          <button type="button" className="icon-btn menu-btn" onClick={() => setSideOpen(true)} aria-label="Open conversations"><Menu /></button>
          <div className="title">{active ? active.title : 'New chat'}</div>
          {me && me.plan === 'flash' && (
            <button type="button" className="btn btn-accent btn-sm" onClick={() => setShowPlans(true)}><Sparkles size={14} /> Upgrade</button>
          )}
        </div>
        <Thread
          key={activeId ?? 'new'}
          conversationId={activeId}
          me={me}
          onConversationCreated={setActiveId}
          onNeedUpgrade={() => setShowPlans(true)}
        />
      </main>

      {showPlans && <PlansModal me={me} onClose={() => setShowPlans(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function ConversationList({ conversations, activeId, onSelect, onDeleted }) {
  const remove = useMutation(api.conversations.remove)
  const [confirmId, setConfirmId] = useState(null)
  return (
    <div className="convo-list">
      <div className="label">Conversations</div>
      {conversations.length === 0 && <div className="empty-list">Your chats will show up here.</div>}
      {conversations.map((c) => (
        <div key={c._id} className={`convo${c._id === activeId ? ' active' : ''}`} onClick={() => onSelect(c._id)} role="button" tabIndex={0}>
          <span className="t">{c.title}</span>
          {confirmId === c._id ? (
            <button
              type="button" className="x confirm"
              onClick={async (e) => { e.stopPropagation(); await remove({ id: c._id }); onDeleted(c._id); setConfirmId(null) }}
            >
              Delete?
            </button>
          ) : (
            <button type="button" className="x" aria-label="Delete conversation" onClick={(e) => { e.stopPropagation(); setConfirmId(c._id) }}>
              <Trash2 />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function PlanCard({ me, onUpgrade }) {
  const portal = useAction(api.billing.createPortal)
  const [busy, setBusy] = useState(false)
  if (!me) return <div className="plan-card"><div className="spinner" /></div>
  const l = me.limits
  const pro = me.plan === 'pro'
  const pct = pro
    ? Math.min(100, Math.round((l.usedCostMicros / l.monthlyCostMicros) * 100))
    : Math.min(100, Math.round((l.usedToday / l.dailyMessages) * 100))
  const manage = async () => {
    setBusy(true)
    try { window.location.href = await portal() } catch (e) { alert(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="plan-card">
      <div className="plan-head">
        <span className={`plan-badge${pro ? ' pro' : ''}`}>{pro ? <Sparkles size={12} /> : <Zap size={12} />} {l.label}</span>
        <span className="plan-model">{l.model}</span>
      </div>
      <div className="meter"><i className={pct > 85 ? 'warn' : ''} style={{ width: `${pct}%` }} /></div>
      <div className="meter-label">
        {pro ? <span>Monthly allowance</span> : <span>Today's messages</span>}
        {pro ? <span>{pct}% used</span> : <span>{l.usedToday} / {l.dailyMessages}</span>}
      </div>
      {pro ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={manage} disabled={busy}>Manage billing</button>
      ) : (
        <button type="button" className="btn btn-primary btn-sm" onClick={onUpgrade}><Sparkles size={14} /> Upgrade to Pro</button>
      )}
    </div>
  )
}

function Thread({ conversationId, me, onConversationCreated, onNeedUpgrade }) {
  const messages = useQuery(api.messages.list, conversationId ? { conversationId } : 'skip') ?? []
  const send = useMutation(api.chat.send)
  const createAttachment = useMutation(api.attachments.create)
  const [text, setText] = useState('')
  const [pending, setPending] = useState([]) // [{ id, name, chars }]
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)

  const streaming = messages.some((m) => m.status === 'streaming')

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const autosize = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'
  }

  const submit = async (override) => {
    const content = (override ?? text).trim()
    if ((!content && pending.length === 0) || sending || streaming) return
    setSending(true)
    setError(null)
    try {
      const res = await send({ conversationId: conversationId ?? undefined, content, attachmentIds: pending.map((p) => p.id) })
      track('charge_message_sent', { plan: me?.plan, attachments: pending.length })
      setText('')
      setPending([])
      if (taRef.current) taRef.current.style.height = 'auto'
      if (!conversationId) onConversationCreated(res.conversationId)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSending(false)
    }
  }

  const onFiles = async (files) => {
    setError(null)
    setParsing(true)
    try {
      for (const file of Array.from(files).slice(0, 3)) {
        const { kind, text: extracted } = await extractText(file)
        const id = await createAttachment({ name: file.name, kind, text: extracted })
        setPending((p) => [...p, { id, name: file.name, chars: extracted.length }])
        track('charge_document_uploaded', { kind })
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const limitHit = isLimit(error)

  return (
    <>
      <div className="thread" ref={scrollRef}>
        {!conversationId ? (
          <div className="welcome">
            <Wordmark />
            <h2>Hi{me?.name ? `, ${me.name.split(' ')[0]}` : ''}. What are you working on?</h2>
            <p>Ask anything about the application process, or upload your CV or cover letter and I'll go through it with you.</p>
            <div className="suggest">
              {SUGGESTIONS.map((s) => <button type="button" key={s} onClick={() => submit(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          <div className="thread-inner">
            {messages.map((m) => <Message key={m._id} m={m} />)}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer">
          {pending.length > 0 && (
            <div className="attach-chips">
              {pending.map((p) => (
                <span className="attach-chip" key={p.id}>
                  <FileText /> {p.name}
                  <button type="button" aria-label="Remove" onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={streaming ? 'Charge is replying…' : 'Ask Charge anything about your application…'}
            onChange={(e) => { setText(e.target.value); autosize() }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            disabled={streaming}
          />
          <div className="composer-row">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            <button type="button" className="icon-btn" title="Attach a CV or cover letter (PDF, Word, text)" onClick={() => fileRef.current?.click()} disabled={parsing}>
              {parsing ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <Paperclip />}
            </button>
            <span className="grow" />
            <span className="hint">Enter to send · Shift+Enter for a new line</span>
            <button type="button" className="send-btn" aria-label="Send" onClick={() => submit()} disabled={sending || streaming || (!text.trim() && pending.length === 0)}>
              <Send />
            </button>
          </div>
        </div>
        {error && (
          <div className="composer-error">
            <span>{stripLimit(error)}</span>
            {limitHit && <button type="button" className="btn btn-accent btn-sm" onClick={onNeedUpgrade}>See Pro</button>}
          </div>
        )}
        <div className="disclaimer">Charge can make mistakes. Check important details like deadlines and entry requirements with the employer.</div>
      </div>
    </>
  )
}

function Message({ m }) {
  const html = useMemo(() => (m.role === 'assistant' ? renderMarkdown(m.content) : null), [m.content, m.role])
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">{m.content || <em>Attached a document</em>}{m.attachmentIds?.length ? <div style={{ fontSize: '0.78rem', opacity: 0.75, marginTop: 4 }}>📎 {m.attachmentIds.length} document{m.attachmentIds.length > 1 ? 's' : ''} attached</div> : null}</div>
      </div>
    )
  }
  return (
    <div className="msg assistant">
      <ChargeMark />
      <div className="bubble">
        {m.status === 'error' ? (
          <div className="msg-error">{m.content}</div>
        ) : m.status === 'streaming' && !m.content ? (
          <div className="typing"><i /><i /><i /></div>
        ) : (
          <div className={`md${m.status === 'streaming' ? ' cursor' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  )
}

function PlansModal({ me, onClose }) {
  const checkout = useAction(api.billing.createCheckout)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const upgrade = async () => {
    setBusy(true)
    setErr(null)
    try {
      track('pro_checkout_started')
      window.location.href = await checkout()
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close"><X /></button>
        <div className="eyebrow">Plans</div>
        <h2 style={{ marginBottom: 4 }}>Pick your <Wordmark /></h2>
        <p className="muted">Both plans know the whole GTOD playbook. Pro runs on a much stronger model and gives you room to go deep.</p>
        <div className="plans">
          <div className="plan">
            <div className="plan-badge"><Zap size={12} /> Flash</div>
            <div className="price">Free</div>
            <ul>
              <li><Check /> 25 messages a day</li>
              <li><Check /> Upload a CV or cover letter for feedback</li>
              <li><Check /> Fast, lightweight model</li>
            </ul>
            <button type="button" className="btn btn-secondary" disabled>{me?.plan === 'flash' ? 'Your current plan' : 'Included'}</button>
          </div>
          <div className="plan pro">
            <div className="plan-badge pro"><Sparkles size={12} /> Pro</div>
            <div className="price">£10 <small>/ month</small></div>
            <ul>
              <li><Check /> Up to 150 messages a day, with a generous monthly allowance</li>
              <li><Check /> Runs on Grok 4.5 for sharper, more detailed feedback</li>
              <li><Check /> Longer memory within each conversation</li>
              <li><Check /> Cancel any time</li>
            </ul>
            {me?.plan === 'pro' ? (
              <button type="button" className="btn btn-secondary" disabled>Your current plan</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={upgrade} disabled={busy}>{busy ? 'Opening checkout…' : 'Upgrade to Pro'}</button>
            )}
          </div>
        </div>
        {err && <p className="msg-error" style={{ marginTop: 12 }}>{err}</p>}
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 14 }}>
          Payments by Stripe. You must be 18+ to subscribe. See our <Link to="/terms" onClick={onClose}>terms</Link>.
        </p>
      </div>
    </div>
  )
}
