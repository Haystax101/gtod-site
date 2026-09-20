import { useEffect, useRef, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { Avatar, Handle, LoyalPill, RankPill, StatusPill } from '../components/Badges'
import StoryText from '../components/StoryText'
import { mmss, pluralise, stamp, timeAgo } from '../lib/format'

const TABS = [
  ['queue', 'Queue'],
  ['roster', 'Roster'],
  ['missions', 'Missions'],
  ['inbox', 'Inbox'],
  ['reports', 'Reports'],
  ['log', 'Log'],
]

export default function HQ() {
  const { token } = useSession()
  const [tab, setTab] = useState(() => (location.hash.replace('#', '') || 'queue'))
  const [inboxAgent, setInboxAgent] = useState(null)
  const openConversation = (agentId) => { setInboxAgent(agentId); setTab('inbox') }
  const queue = useQuery(api.missions.queue, { token })
  const unread = useQuery(api.directLine.unreadForMe, { token }) ?? 0
  const reports = useQuery(api.forum.openReports, { token })

  useEffect(() => { history.replaceState(null, '', `#${tab}`) }, [tab])

  const counts = { queue: queue?.filter((s) => s.status === 'pending').length, inbox: unread, reports: reports?.length }

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Headquarters · <b>Lead Operative</b></span>
        <h1 className="display">HQ</h1>
      </div>
      <div className="hqtabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}{counts[k] ? <span className="badge-n">{counts[k]}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'queue' && <Queue queue={queue} />}
      {tab === 'roster' && <Roster onMessage={openConversation} />}
      {tab === 'missions' && <MissionsAdmin />}
      {tab === 'inbox' && <Inbox agentId={inboxAgent} setAgentId={setInboxAgent} />}
      {tab === 'reports' && <Reports reports={reports} />}
      {tab === 'log' && <Log />}
    </div>
  )
}

// ------------------------------------------------------------------- queue

function Queue({ queue }) {
  const { token } = useSession()
  const recent = useQuery(api.missions.recent, { token })
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><span className="eyebrow">Stories to read</span></div>
        {queue === undefined ? <div className="empty"><span className="spin" /></div>
          : queue.length === 0 ? <div className="empty">Queue clear.</div>
          : queue.map((s) => <QueueItem key={s._id} s={s} />)}
      </div>
      <div className="card">
        <div className="card-head"><span className="eyebrow">Recent decisions</span></div>
        {recent?.length === 0 && <div className="empty">Nothing reviewed yet.</div>}
        {recent?.map((s) => <QueueItem key={s._id} s={s} compact />)}
      </div>
    </div>
  )
}

function QueueItem({ s, compact }) {
  const { token } = useSession()
  const review = useMutation(api.missions.review)
  const [points, setPoints] = useState(s.status === 'approved' ? s.verifiedCount ?? 1 : 1)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(!compact)

  async function decide(status) {
    setBusy(true)
    try {
      await review({ token, submissionId: s._id, status, points, reviewNote: note || undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sub-row">
      <Avatar agent={s.agent} />
      <div className="body">
        <div className="row between">
          <div className="t"><Handle agent={s.agent} /> · {s.title}</div>
          <StatusPill status={s.status} />
        </div>
        <div className="m">
          {stamp(s.createdAt)}
          {s.verifiedCount !== undefined && <> · {pluralise(s.verifiedCount, 'point')} awarded</>}
          {s.reviewedBy === 'auto' && ' · auto (legacy)'}
        </div>
        {s.story && <StoryText text={s.story} />}
        {compact && !open ? (
          <button className="linkbtn tiny" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>Details / change verdict</button>
        ) : (
          <>
            {s.reviewNote && s.reviewedBy !== 'auto' && <div className="note">Your note: {s.reviewNote}</div>}
            <LegacyEvidence s={s} />
            <div className="row" style={{ marginTop: 10 }}>
              <div className="counter">
                <button type="button" onClick={() => setPoints((p) => Math.max(0, p - 1))}>−</button>
                <span>{points}</span>
                <button type="button" onClick={() => setPoints((p) => Math.min(50, p + 1))}>+</button>
              </div>
              <input className="input" style={{ flex: 1, minWidth: 140, padding: '8px 10px' }} placeholder="Note to agent (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {s.status !== 'approved' && <button className="btn sm teal" disabled={busy} onClick={() => decide('approved')}>Approve · {pluralise(points, 'point')}</button>}
              {s.status !== 'rejected' && <button className="btn sm danger" disabled={busy} onClick={() => decide('rejected')}>Reject</button>}
              {s.status === 'approved' && <button className="btn sm ghost" disabled={busy} onClick={() => decide('approved')}>Re-score to {points}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Whatever is left from the voice-evidence era, folded away out of the reading flow. */
function LegacyEvidence({ s }) {
  if (!s.storageId && !s.link && !s.note && !s.transcript && !s.verdict) return null
  return (
    <details className="more" style={{ marginTop: 8 }}>
      <summary>Legacy evidence{s.durationSec ? ` · ${mmss(s.durationSec)}` : ''}</summary>
      {s.note && <div className="note">Field note: {s.note}</div>}
      {s.claimedCount !== undefined && <div className="m">claimed {s.claimedCount}</div>}
      {s.verdict && (
        <div className="note">
          Analyst: {s.verdict.saidPhrase ? 'line heard' : 'line NOT heard'}, {s.verdict.gotResponse ? 'reply heard' : 'no reply'},
          {' '}{pluralise(s.verdict.encounterCount, 'encounter')}, confidence {Math.round(s.verdict.confidence * 100)}%.
          {' '}<span className="dim">{s.verdict.reasoning}</span>
        </div>
      )}
      {s.storageId && <Evidence submissionId={s._id} />}
      {s.link && <div style={{ marginTop: 8 }}><a href={s.link} target="_blank" rel="noreferrer" className="mono small">{s.link}</a></div>}
      {s.transcript && <div className="transcript">{s.transcript}</div>}
    </details>
  )
}

function Evidence({ submissionId }) {
  const { token } = useSession()
  const url = useQuery(api.missions.evidenceUrl, { token, submissionId })
  if (url === undefined) return <span className="spin" />
  if (url === null) return <div className="tiny dim" style={{ marginTop: 8 }}>Evidence purged.</div>
  return <audio className="player" controls preload="none" src={url} />
}

// ------------------------------------------------------------------ roster

function Roster({ onMessage }) {
  const { token, me } = useSession()
  const roster = useQuery(api.agents.roster, { token })
  const setRank = useMutation(api.agents.setRank)
  const setStatus = useMutation(api.agents.setStatus)
  const setLoyal = useMutation(api.agents.setLoyal)
  const resetPassword = useAction(api.auth.resetPassword)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)

  const rows = (roster ?? []).filter((a) => a.handle.includes(q.toLowerCase()))

  async function reset(a) {
    const next = window.prompt(`New temporary password for @${a.displayHandle} (min 8 chars). They will be logged out everywhere.`)
    if (!next) return
    try {
      await resetPassword({ token, agentId: a._id, next })
      setMsg(`Password for @${a.displayHandle} reset. Tell them: ${next}`)
    } catch (err) {
      setMsg(errMsg(err))
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="eyebrow">{roster ? pluralise(roster.length, 'agent') : 'Roster'}</span>
        <input className="input mono" style={{ width: 160, padding: '6px 10px' }} placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {msg && <div className="notice teal" style={{ marginBottom: 10 }}>{msg} <button className="linkbtn" onClick={() => setMsg(null)}>dismiss</button></div>}
      {roster === undefined && <div className="empty"><span className="spin" /></div>}
      {rows.map((a) => (
        <div key={a._id} className={`roster-row${a.status === 'removed' ? ' removed' : ''}`}>
          <Avatar agent={a} />
          <div style={{ minWidth: 0 }}>
            <div className="h"><Handle agent={a} /> {a.loyal && <LoyalPill />}</div>
            <div className="m">{a.points} points · seen {timeAgo(a.lastSeenAt)} · joined {timeAgo(a.createdAt)}{a.status === 'removed' && ' · REMOVED'}</div>
            {a.university && <div className="m" style={{ color: a.universityId === 'other' ? 'var(--amber)' : undefined }}>{a.universityId === 'other' ? `Not in list: ${a.university}` : a.university}</div>}
          </div>
          {a._id === me._id ? (
            <RankPill rank={a.rank} rankLabel={a.rankLabel} />
          ) : (
            <div className="roster-ctl">
              <select className="input sm" value={a.rank} onChange={(e) => setRank({ token, agentId: a._id, rank: e.target.value })}>
                <option value="junior">Junior Agent</option>
                <option value="senior">Senior Agent</option>
                <option value="advanced">Advanced Operative</option>
                <option value="lead">Lead Operative</option>
              </select>
              <button className="btn xs teal" onClick={() => onMessage(a._id)}>Message</button>
              <button className="btn xs ghost" onClick={() => setLoyal({ token, agentId: a._id, loyal: !a.loyal })}>{a.loyal ? 'Unloyal' : 'Loyal'}</button>
              <button className="btn xs ghost" onClick={() => reset(a)}>Reset pw</button>
              {a.status === 'active'
                ? <button className="btn xs danger" onClick={() => window.confirm(`Remove @${a.displayHandle}? They are logged out immediately and cannot re-enrol.`) && setStatus({ token, agentId: a._id, status: 'removed' })}>Remove</button>
                : <button className="btn xs ghost" onClick={() => setStatus({ token, agentId: a._id, status: 'active' })}>Restore</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// -------------------------------------------------------- missions (admin)

function MissionsAdmin() {
  const { token } = useSession()
  const all = useQuery(api.missions.listAll, { token })
  const upsert = useMutation(api.missions.upsertChallenge)
  const [editing, setEditing] = useState(null) // null | 'new' | challenge
  const [form, setForm] = useState({ title: '', brief: '', phrase: '' })
  const [error, setError] = useState(null)

  function edit(c) {
    setEditing(c)
    setForm(c === 'new' ? { title: '', brief: '', phrase: 'You here for uni then?' } : { title: c.title, brief: c.brief, phrase: c.phrase })
  }

  async function save(e) {
    e.preventDefault()
    setError(null)
    try {
      await upsert({ token, id: editing === 'new' ? undefined : editing._id, ...form })
      setEditing(null)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  return (
    <div className="stack">
      {editing ? (
        <form className="card bracket" onSubmit={save}>
          <div className="field"><label>Title</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} required /></div>
          <div className="field"><label>Brief</label><textarea className="input" value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} maxLength={600} /></div>
          <div className="field"><label>The line the mission is built around</label><input className="input mono" value={form.phrase} onChange={(e) => setForm({ ...form, phrase: e.target.value })} maxLength={120} /></div>
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn sm" type="submit">Save</button>
            <button className="btn sm ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn sm" onClick={() => edit('new')}>New mission</button>
      )}
      <div className="card">
        {all === undefined && <div className="empty"><span className="spin" /></div>}
        {all?.length === 0 && <div className="empty">No missions yet. Create the first one.</div>}
        {all?.map((c) => (
          <div key={c._id} className="sub-row">
            <div className="body">
              <div className="row between">
                <div className="t">{c.title}</div>
                <span className={`pill ${c.status === 'active' ? 'green' : ''}`}>{c.status}</span>
              </div>
              <div className="small muted">{c.brief}</div>
              <div className="m">"{c.phrase}"</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn xs ghost" onClick={() => edit(c)}>Edit</button>
                <button className="btn xs ghost" onClick={() => upsert({ token, id: c._id, title: c.title, brief: c.brief, phrase: c.phrase, status: c.status === 'active' ? 'archived' : 'active' })}>
                  {c.status === 'active' ? 'Archive' : 'Reactivate'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- inbox

function Inbox({ agentId, setAgentId }) {
  const { token } = useSession()
  const inbox = useQuery(api.directLine.inbox, { token })
  if (agentId) return <Conversation agentId={agentId} onBack={() => setAgentId(null)} />
  return (
    <div className="stack">
    <WelcomeEditor />
    <div className="card">
      <div className="card-head"><span className="eyebrow">Direct line</span><span className="tiny dim">To message someone new: Roster → Message</span></div>
      {inbox === undefined && <div className="empty"><span className="spin" /></div>}
      {inbox?.length === 0 && <div className="empty">Nobody has called in yet.</div>}
      {inbox?.map(({ agent, last, unread }) => (
        <a key={agent._id} href="#inbox" className="inbox-row" onClick={(e) => { e.preventDefault(); setAgentId(agent._id) }}>
          <Avatar agent={agent} />
          <div className="prev">
            <div className="h">@{agent.displayHandle} <span className="dim">· {timeAgo(last.createdAt)}</span></div>
            <div className="p">{last.fromLead ? 'You: ' : ''}{last.body}</div>
          </div>
          {unread > 0 && <span className="badge-n">{unread}</span>}
        </a>
      ))}
    </div>
    </div>
  )
}

function WelcomeEditor() {
  const { token } = useSession()
  const welcome = useQuery(api.directLine.welcome, { token })
  const setWelcome = useMutation(api.directLine.setWelcome)
  const [text, setText] = useState(null)
  const [saved, setSaved] = useState(false)
  const value = text ?? welcome?.text ?? ''
  if (welcome === undefined) return null
  return (
    <details className="card" style={{ padding: 0 }}>
      <summary style={{ padding: 18, cursor: 'pointer', listStyle: 'none' }}>
        <span className="eyebrow">Welcome message · <b>{welcome.text.trim() ? 'sent to every new agent' : 'off'}</b></span>
        <span className="tiny dim" style={{ float: 'right' }}>edit</span>
      </summary>
      <div style={{ padding: '0 18px 18px' }}>
        <textarea className="input" rows={8} value={value} onChange={(e) => { setText(e.target.value); setSaved(false) }} maxLength={1500} placeholder="Leave empty to send nothing on sign-up." />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={async () => { await setWelcome({ token, text: value }); setSaved(true) }}>Save</button>
          {saved && <span className="pill green">Saved</span>}
          <span className="tiny dim">Sent once, at enrolment, as the first message in their direct line. Changes only affect future sign-ups.</span>
        </div>
      </div>
    </details>
  )
}

function Conversation({ agentId, onBack }) {
  const { token } = useSession()
  const convo = useQuery(api.directLine.conversation, { token, agentId })
  const send = useMutation(api.directLine.send)
  const markRead = useMutation(api.directLine.markRead)
  const [body, setBody] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
    if (convo?.messages.some((m) => !m.fromLead && m.readAt === undefined)) markRead({ token, agentId }).catch(() => {})
  }, [convo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function go(e) {
    e.preventDefault()
    await send({ token, body, agentId })
    setBody('')
  }

  return (
    <div className="stack">
      <button className="backlink" style={{ background: 'none', border: 'none' }} onClick={onBack}>← Inbox</button>
      {convo?.agent && (
        <div className="row">
          <Avatar agent={convo.agent} />
          <div>
            <div className="mono small"><Handle agent={convo.agent} /></div>
            <RankPill rank={convo.agent.rank} rankLabel={convo.agent.rankLabel} small />
          </div>
        </div>
      )}
      <div className="card">
        <div className="chat">
          {convo?.messages.map((m) => (
            <div key={m._id} className={`msg ${m.fromLead ? 'mine' : 'theirs'}`}>
              {m.body}
              <span className="when">{stamp(m.createdAt)}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <div className="composer">
        <form onSubmit={go}>
          <textarea className="input" placeholder="Reply as HQ…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1500} required rows={1} />
          <button className="btn" type="submit">Send</button>
        </form>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- reports

function Reports({ reports }) {
  const { token } = useSession()
  const moderatePost = useMutation(api.forum.moderatePost)
  return (
    <div className="card">
      <div className="card-head"><span className="eyebrow">Open reports</span></div>
      {reports === undefined && <div className="empty"><span className="spin" /></div>}
      {reports?.length === 0 && <div className="empty">Nothing reported.</div>}
      {reports?.map((r) => (
        <div key={r._id} className="sub-row">
          <div className="body">
            <div className="m">@{r.reporter?.displayHandle} reported @{r.author?.displayHandle} · {timeAgo(r.createdAt)}</div>
            <div className="note">Reason: {r.reason || '(none given)'}</div>
            {r.post ? <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.post.body}</div> : <div className="dim small">Post deleted.</div>}
            <div className="row" style={{ marginTop: 8 }}>
              {r.post && <button className="btn xs danger" onClick={() => moderatePost({ token, postId: r.postId, hidden: true, resolveReports: true })}>Hide post</button>}
              {r.post && <button className="btn xs ghost" onClick={() => moderatePost({ token, postId: r.postId, hidden: r.post.hidden, resolveReports: true })}>Dismiss</button>}
              {r.post?.authorId && <a className="btn xs ghost" href={`/agents/forum/${r.post.threadId}`}>Open thread</a>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// --------------------------------------------------------------------- log

function Log() {
  const { token } = useSession()
  const rows = useQuery(api.agents.auditLog, { token })
  return (
    <div className="card">
      <div className="card-head"><span className="eyebrow">Audit log</span></div>
      {rows === undefined && <div className="empty"><span className="spin" /></div>}
      {rows?.length === 0 && <div className="empty">Empty.</div>}
      {rows?.map((r) => (
        <div key={r._id} className="log-row">
          <span className="when">{stamp(r.createdAt)}</span>
          <span><b>{r.actor}</b> {r.action} {r.meta ? <span className="dim">{r.meta}</span> : null}</span>
        </div>
      ))}
    </div>
  )
}
