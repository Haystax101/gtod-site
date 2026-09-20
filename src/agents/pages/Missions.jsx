import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { StatusPill } from '../components/Badges'
import StoryText from '../components/StoryText'
import { pluralise, stamp } from '../lib/format'

const FREEFORM = '__own__'
const MIN_STORY = 80
const MAX_STORY = 4000

const PROMPTS = [
  'Where were you, and who did you pick?',
  'What did you say, and how did they take it?',
  'What did they say back?',
  'How did it end?',
]

export default function Missions() {
  const { token } = useSession()
  const challenges = useQuery(api.missions.list, { token })
  const mine = useQuery(api.missions.mine, { token })
  const submit = useMutation(api.missions.submit)

  const [picked, setPicked] = useState(null)
  const [ownTitle, setOwnTitle] = useState('')
  const [story, setStory] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const formRef = useRef(null)

  // Default to the first official mission once they load.
  useEffect(() => {
    if (picked === null && challenges?.length) setPicked(challenges[0]._id)
  }, [challenges, picked])

  const left = MIN_STORY - story.trim().length

  async function send(e) {
    e.preventDefault()
    setError(null)
    if (left > 0) return setError(`Give us a bit more: ${pluralise(left, 'character')} to go.`)
    setBusy(true)
    try {
      await submit({
        token,
        challengeId: picked === FREEFORM ? undefined : picked,
        freeformTitle: picked === FREEFORM ? ownTitle : undefined,
        story,
        visibility,
      })
      setStory('')
      setSent(true)
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" ref={formRef}>
      <div className="page-head">
        <span className="eyebrow">Operations · <b>Active</b></span>
        <h1 className="display">Missions</h1>
        <p className="small">Pick a mission, go and do it, then write up what happened. HQ reads every report and decides what it is worth. Public reports go up on the brief once approved; private ones stay between you and HQ.</p>
      </div>

      {sent && !story && (
        <div className="card" style={{ borderColor: 'var(--green)' }}>
          <div className="row between">
            <span className="eyebrow"><b style={{ color: 'var(--green)' }}>Filed.</b> HQ will read it and come back to you.</span>
            <span className="stamp green">Logged</span>
          </div>
        </div>
      )}

      <form onSubmit={send} className="stack">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>01 · Choose the mission</div>
          <div className="stack">
            {challenges === undefined && <div className="empty"><span className="spin" /></div>}
            {challenges?.map((c) => (
              <button type="button" key={c._id} className={`mission${picked === c._id ? ' selected' : ''}`} onClick={() => setPicked(c._id)}>
                <div className="t">{c.title}</div>
                <div className="b">{c.brief}</div>
                <div className="phrase">"{c.phrase}"</div>
              </button>
            ))}
            <button type="button" className={`mission${picked === FREEFORM ? ' selected' : ''}`} onClick={() => setPicked(FREEFORM)}>
              <div className="t">Your own mission</div>
              <div className="b">Invented something better? Log it here and name it yourself.</div>
              {picked === FREEFORM && (
                <input className="input" style={{ marginTop: 10 }} placeholder="Name the mission" value={ownTitle} onChange={(e) => setOwnTitle(e.target.value)} maxLength={80} onClick={(e) => e.stopPropagation()} />
              )}
            </button>
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>02 · The story</div>
          <div className="card">
            <ul className="prompts">
              {PROMPTS.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <textarea
              className="input"
              rows={10}
              value={story}
              onChange={(e) => { setStory(e.target.value); setSent(false) }}
              maxLength={MAX_STORY}
              placeholder="Tell it how it happened…"
            />
            <div className="row between" style={{ marginTop: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span className="tiny dim" style={{ flex: 1 }}>No recordings, no photos. Your words only, and no surnames or anything that identifies the person you asked.</span>
              <span className={`tiny mono ${left > 0 ? 'dim' : ''}`} style={{ whiteSpace: 'nowrap', ...(left > 0 ? {} : { color: 'var(--green)' }) }}>
                {left > 0 ? `${left} more` : `${story.trim().length} / ${MAX_STORY}`}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>03 · Who sees it</div>
          <div className="card">
            <div className="choice">
              {[
                ['public', 'Public', 'Goes up on the brief once HQ approves it. Other agents can react and comment.'],
                ['private', 'Private', 'Only you and HQ ever read it. It still counts for points.'],
              ].map(([k, label, blurb]) => (
                <button type="button" key={k} className={`opt${visibility === k ? ' on' : ''}`} onClick={() => setVisibility(k)}>
                  <div className="t">{label}</div>
                  <div className="b">{blurb}</div>
                </button>
              ))}
            </div>
            <p className="tiny dim" style={{ marginTop: 10 }}>You can change this later on any report.</p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn block" type="submit" disabled={busy}>
          {busy ? <span className="spin" /> : 'File your report'}
        </button>
      </form>

      <div className="card">
        <div className="card-head">
          <span className="eyebrow">Your reports</span>
        </div>
        {mine === undefined ? (
          <div className="empty"><span className="spin" /></div>
        ) : mine.length === 0 ? (
          <div className="empty">Nothing on file yet.</div>
        ) : (
          mine.map((s) => <SubmissionRow key={s._id} s={s} />)
        )}
      </div>
    </div>
  )
}

function SubmissionRow({ s }) {
  const { token } = useSession()
  const setVisibility = useMutation(api.missions.setVisibility)
  const isPublic = (s.visibility ?? 'public') === 'public'
  const live = s.status === 'approved' && isPublic

  return (
    <div className="sub-row">
      <div className="body">
        <div className="row between">
          <div className="t">{s.title}</div>
          <StatusPill status={s.status} />
        </div>
        <div className="m">
          {stamp(s.createdAt)} · {isPublic ? 'public' : 'private'}
          {s.status === 'approved' && <> · <span style={{ color: 'var(--green)' }}>{pluralise(s.verifiedCount ?? 0, 'point')}</span></>}
        </div>
        {s.story ? <StoryText text={s.story} /> : s.note && <div className="note">Field note: {s.note}</div>}
        {s.reviewNote && <div className="note">HQ: {s.reviewNote}</div>}
        <div className="row" style={{ gap: 12, marginTop: 6 }}>
          <button className="linkbtn tiny" onClick={() => setVisibility({ token, submissionId: s._id, visibility: isPublic ? 'private' : 'public' })}>
            {isPublic ? 'Make private' : 'Make public'}
          </button>
          {live && <Link to={`/s/${s._id}`} className="linkbtn tiny">Open →</Link>}
        </div>
      </div>
    </div>
  )
}
