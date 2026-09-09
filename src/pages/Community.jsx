import { Component, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SignInButton, SignUpButton } from '@clerk/clerk-react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { ArrowLeft, Check, Clock, CornerDownRight, Flag, Send, ShieldCheck, Users } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import { track } from '../lib/analytics.js'
import { Wordmark } from '../components/Wordmark.jsx'
import AppNav from '../components/AppNav.jsx'
import '../styles/timeline.css'
import '../styles/community.css'

const errorText = (err) => err?.data?.message ?? err?.data ?? err?.message ?? 'Something went wrong'

// Mirrors MAX_POST_CHARS in convex/moderation.ts. The server is the authority;
// this only stops someone typing 3,000 characters before being told.
const MAX_POST = 2000

const REPORT_REASONS = ['Bullying or harassment', 'Sexual or inappropriate', 'Spam or a scam', 'Personal details shared', 'Something else']

function relative(ts) {
  if (typeof ts !== 'number') return ''
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function Community() {
  useEffect(() => {
    const prev = document.title
    document.title = 'Cohorts | Get There One Day'
    return () => { document.title = prev }
  }, [])
  if (!backendConfigured) return <NotConfigured />
  return <Gate />
}

function NotConfigured() {
  return (
    <div className="app-gate">
      <Wordmark />
      <h1>Cohorts aren't switched on yet</h1>
      <p>This build has no Clerk or Convex keys, so we can't load the community. Add them and redeploy.</p>
      <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook instead</Link>
    </div>
  )
}

function LoadingPage({ label }) {
  return (
    <div className="app-page">
      <div className="wrap skel-stack" aria-busy="true" aria-label={label}>
        <div className="skel w-40" /><div className="skel tall" /><div className="skel tall" />
      </div>
    </div>
  )
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) return <LoadingPage label="Loading cohorts" />
  if (!isAuthenticated) {
    return (
      <div className="app-gate">
        <div className="eyebrow">Cohorts</div>
        <h1>The people applying to the same scheme as you</h1>
        <p>
          Small groups, one per scheme and intake year. Not a general teen forum: a room full of
          people sitting the same assessment centre in the same month.
        </p>
        <ul className="feature-list">
          <li>Scoped to one scheme and one intake, so it stays useful</li>
          <li>Every post is read by a moderator before it appears</li>
          <li>Report and block are there from day one</li>
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
            <strong>We couldn't load the cohorts.</strong>
            <p>{errorText(this.state.error)}</p>
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>Try again</button>
              <Link className="btn btn-ghost btn-sm" to="/timeline">Back to your timeline</Link>
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

  // listCohorts already returns only enabled cohorts.
  const cohorts = useQuery(api.community.listCohorts, {})
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState(null)

  const open = useMemo(() => cohorts ?? [], [cohorts])

  // Land people straight in a cohort they've already joined.
  useEffect(() => {
    if (selectedId || open.length === 0) return
    const joined = open.find((c) => c.joined)
    if (joined) setSelectedId(joined._id)
  }, [open, selectedId])

  if (cohorts === undefined) return <LoadingPage label="Loading cohorts" />
  if (open.length === 0) return <OpeningSoon />

  const selected = open.find((c) => c._id === selectedId) ?? null

  return (
    <div className="app-page">
      <div className="wrap">
        <div className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">Cohorts</div>
            <h1>Your cohorts</h1>
            <p>One group per scheme and intake. Posts are read by a moderator before they go up.</p>
          </div>
          <div className="app-head-actions">
            
          </div>
        </div>

        {error && <p className="inline-error" role="alert">{error}</p>}

        <div className={`community${selected ? ' in-feed' : ''}`}>
          <div className="cohort-rail">
            <div className="rail-head">Open cohorts</div>
            {open.map((c) => (
              <CohortCard
                key={c._id}
                cohort={c}
                selected={c._id === selectedId}
                onSelect={() => setSelectedId(c._id)}
                onJoined={() => setSelectedId(c._id)}
                onLeft={() => setSelectedId((id) => (id === c._id ? null : id))}
                onError={setError}
              />
            ))}
          </div>

          <div>
            {selected ? (
              <CohortFeed cohort={selected} onBack={() => setSelectedId(null)} onError={setError} />
            ) : (
              <div className="feed-empty">
                <h3>Pick a cohort</h3>
                <p>Join the one that matches the scheme you're applying to. You can be in more than one.</p>
              </div>
            )}
          </div>
        </div>

        <p className="house-rules">
          Be decent, and don't post anything that identifies you or anyone else: full name, school,
          address, phone number, socials. Anything reported goes to a human. See our{' '}
          <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.
        </p>
      </div>
    </div>
  )
}

function CohortCard({ cohort: c, selected, onSelect, onJoined, onLeft, onError }) {
  const joinCohort = useMutation(api.community.joinCohort)
  const leaveCohort = useMutation(api.community.leaveCohort)
  const [busy, setBusy] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const run = async (fn, event, after) => {
    setBusy(true)
    onError(null)
    try {
      await fn({ cohortId: c._id })
      track(event, { slug: c.slug })
      after?.()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
      setConfirmLeave(false)
    }
  }

  // The card is a container, not a control: nesting Join/Leave inside a
  // clickable card would put a button inside a button.
  return (
    <div className={`cohort${c.joined ? ' selectable' : ''}`} aria-current={selected || undefined}>
      {c.joined ? (
        <button type="button" className="c-name as-select" onClick={onSelect} aria-label={`Open ${c.name}`}>{c.name}</button>
      ) : (
        <span className="c-name">{c.name}</span>
      )}
      <span className="c-meta">
        <span>Intake {c.intakeYear}</span>
        <span className="member"><Users size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />{c.memberCount ?? 0}</span>
      </span>
      <div className="c-actions">
        {c.joined ? (
          <>
            <span className="joined-tag"><Check aria-hidden="true" /> Joined</span>
            <span style={{ flex: 1 }} />
            {confirmLeave ? (
              <button type="button" className="link-btn danger" disabled={busy} onClick={() => run(leaveCohort, 'cohort_left', onLeft)}>
                Leave for good?
              </button>
            ) : (
              <button type="button" className="link-btn" onClick={() => setConfirmLeave(true)}>Leave</button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(joinCohort, 'cohort_joined', onJoined)}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        )}
      </div>
    </div>
  )
}

function CohortFeed({ cohort, onBack, onError }) {
  const feed = useQuery(api.community.cohortFeed, { cohortId: cohort._id })
  const posts = feed?.posts ?? []

  return (
    <>
      <div className="feed-head">
        <button type="button" className="btn btn-ghost btn-sm back" onClick={onBack}><ArrowLeft size={15} /> Cohorts</button>
        <h2>{cohort.name}</h2>
        <span className="grow" />
        <span className="stage-badge tone-live sm"><i aria-hidden="true" />Intake {cohort.intakeYear}</span>
      </div>

      {feed === undefined ? (
        <div className="feed skel-stack" aria-busy="true" aria-label="Loading posts">
          <div className="skel tall" /><div className="skel tall" />
        </div>
      ) : !feed.joined ? (
        <div className="feed-empty">
          <h3>Join {cohort.name} to read along</h3>
          <p>Everyone in a cohort is a joined member — there's no lurking, in either direction.</p>
        </div>
      ) : (
        <>
          <Composer cohort={cohort} onError={onError} />
          {posts.length === 0 ? (
            <div className="feed-empty" style={{ marginTop: 14 }}>
              <h3>Nobody's posted yet</h3>
              <p>
                Someone has to go first. A good opener: where you're up to with the application, and
                the bit you're least sure about.
              </p>
            </div>
          ) : (
            <div className="feed">
              {posts.map((p) => <Thread key={p._id} post={p} cohort={cohort} onError={onError} />)}
            </div>
          )}
        </>
      )}
    </>
  )
}

function Composer({ cohort, onError, replyToId, onDone, compact }) {
  const createPost = useMutation(api.community.createPost)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const over = body.length > MAX_POST
  const submit = async (e) => {
    e.preventDefault()
    const text = body.trim()
    if (!text || over || busy) return
    setBusy(true)
    onError(null)
    try {
      const res = await createPost({ cohortId: cohort._id, body: text, replyToId })
      track('cohort_post_created', { slug: cohort.slug, reply: Boolean(replyToId), status: res?.status })
      setBody('')
      setSent(true)
      setTimeout(() => { setSent(false); onDone?.() }, 6000)
    } catch (err) {
      onError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const id = replyToId ? `reply-${replyToId}` : 'post-body'

  return (
    <form className={`composer-card${compact ? ' compact' : ''}`} onSubmit={submit}>
      <label htmlFor={id} className={compact ? 'sr-only' : 'field-label'}>
        {replyToId ? 'Write a reply' : `Post to ${cohort.name}`}
      </label>
      <textarea
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={replyToId ? 'Reply…' : "Where are you up to? What's the bit you're stuck on?"}
      />
      <div className="composer-row">
        <span className={`count${over ? ' over' : ''}`}>{body.length} / {MAX_POST}</span>
        <span className="grow" />
        {sent && <span className="joined-tag" role="status"><Check aria-hidden="true" /> Sent to a moderator</span>}
        {replyToId && <button type="button" className="link-btn" onClick={onDone}>Cancel</button>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!body.trim() || over || busy}>
          <Send size={14} /> {busy ? 'Sending…' : replyToId ? 'Reply' : 'Post'}
        </button>
      </div>
      {!compact && (
        <p className="mod-note">
          <ShieldCheck aria-hidden="true" />
          <span>
            A moderator reads every post before it goes up. It's usually quick, and you'll see yours
            here while it waits. Don't post your full name, school or contact details.
          </span>
        </p>
      )}
    </form>
  )
}

function Thread({ post, cohort, onError }) {
  const [replying, setReplying] = useState(false)
  const replies = post.replies ?? []
  return (
    <div className="thread-block">
      <Post post={post} onError={onError} onReply={() => setReplying(true)} canReply={!post.awaitingReview} />
      {replies.length > 0 && (
        <div className="replies">
          {replies.map((r) => <Post key={r._id} post={r} onError={onError} isReply />)}
        </div>
      )}
      {replying && (
        <div className="replies">
          <Composer cohort={cohort} onError={onError} replyToId={post._id} onDone={() => setReplying(false)} compact />
        </div>
      )}
    </div>
  )
}

function Post({ post, onError, onReply, canReply, isReply }) {
  const reportPost = useMutation(api.community.reportPost)
  const blockUser = useMutation(api.community.blockUser)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState(null)
  const [reported, setReported] = useState(false)
  const [busy, setBusy] = useState(false)

  const pending = post.awaitingReview ?? post.status === 'pending'

  const submitReport = async () => {
    if (!reason || busy) return
    setBusy(true)
    onError(null)
    try {
      await reportPost({ postId: post._id, reason })
      track('cohort_post_reported')
      setReporting(false)
      setReported(true)
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const block = async () => {
    if (!post.author?.id) return
    if (!window.confirm(`Block ${post.author.name || 'this person'}? You won't see their posts, and they won't see yours.`)) return
    onError(null)
    try {
      await blockUser({ userId: post.author.id })
      track('cohort_user_blocked')
    } catch (e) {
      onError(errorText(e))
    }
  }

  return (
    <article className={`post${pending ? ' pending' : ''}${isReply ? ' is-reply' : ''}`}>
      <div className="post-top">
        {isReply && <CornerDownRight className="reply-arrow" aria-hidden="true" />}
        <span className="who">{post.isMine ? 'You' : post.author?.name || 'A member'}</span>
        <span className="when">{relative(post.createdAt)}</span>
      </div>

      {pending && (
        <p className="post-banner waiting">
          <Clock aria-hidden="true" />
          <span>
            <strong>Your post is with a moderator — it'll appear shortly.</strong>
            <span>
              Nothing has gone wrong and you haven't done anything wrong. Every post is read by a
              person before it goes up, and until then only you can see this one.
            </span>
          </span>
        </p>
      )}

      <div className="post-body">{post.body}</div>

      <div className="post-actions">
        {canReply && !post.isMine && (
          <button type="button" className="link-btn" onClick={onReply}>Reply</button>
        )}
        {canReply && post.isMine && (
          <button type="button" className="link-btn" onClick={onReply}>Add to this</button>
        )}
        {!post.isMine && !pending && (
          reported ? (
            <span className="inline-note" role="status">Thanks — a moderator will look at this.</span>
          ) : reporting ? null : (
            <>
              <button type="button" className="link-btn" onClick={() => setReporting(true)}>
                <Flag size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />Report
              </button>
              <button type="button" className="link-btn" onClick={block}>Block</button>
            </>
          )
        )}
      </div>

      {reporting && (
        <div className="report-form">
          <span className="r-title">What's wrong with this post?</span>
          <div className="reasons">
            {REPORT_REASONS.map((r) => (
              <button key={r} type="button" className="reason" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" disabled={!reason || busy} onClick={submitReport}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" className="link-btn" onClick={() => { setReporting(false); setReason(null) }}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  )
}

function OpeningSoon() {
  return (
    <div className="app-page">
      <div className="wrap">
        <AppNav />
        <div className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">Cohorts</div>
            <h1>Opening soon, on purpose</h1>
          </div>
        </div>
        <div className="cohort-empty">
          <p>
            There are no cohorts open yet. That isn't an oversight: most of the people using GTOD
            are under 18, and putting them in a room together is something we only want to do once
            it's properly staffed and properly safe.
          </p>
          <p>Before the first cohort opens, all of this has to be true:</p>
          <ul className="safety">
            <li><ShieldCheck aria-hidden="true" /> A named person is responsible for reading every post before it appears.</li>
            <li><ShieldCheck aria-hidden="true" /> Report and block work, and reports reach a human quickly.</li>
            <li><ShieldCheck aria-hidden="true" /> Each cohort is tied to one scheme and one intake year, not a general chat.</li>
          </ul>
          <p className="muted" style={{ fontSize: '0.92rem' }}>
            In the meantime the useful stuff is already here: your{' '}
            <Link to="/timeline" style={{ color: 'var(--teal)', fontWeight: 600 }}>timeline</Link>, your{' '}
            <Link to="/answers" style={{ color: 'var(--teal)', fontWeight: 600 }}>answer bank</Link>, and{' '}
            <Link to="/charge" style={{ color: 'var(--teal)', fontWeight: 600 }}>Charge</Link>.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/timeline">Go to your timeline</Link>
            <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
