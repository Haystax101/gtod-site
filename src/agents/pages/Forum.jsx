import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { pluralise, timeAgo } from '../lib/format'

export const CATS = [
  ['general', 'General'],
  ['missions', 'Mission talk'],
  ['intel', 'Intel'],
]

export default function Forum() {
  const { token } = useSession()
  const [cat, setCat] = useState(null)
  const [composing, setComposing] = useState(false)
  const threads = useQuery(api.forum.threads, { token, category: cat ?? undefined })
  const rooms = useQuery(api.rooms.list, { token })

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row between">
          <div>
            <span className="eyebrow">Comms · <b>Members only</b></span>
            <h1 className="display">Forum</h1>
          </div>
          <button className="btn sm" onClick={() => setComposing((c) => !c)}>{composing ? 'Cancel' : 'New thread'}</button>
        </div>
      </div>

      {composing && <NewThread onDone={() => setComposing(false)} />}

      {rooms && rooms.length > 0 && (
        <div className="card bracket">
          <div className="card-head">
            <span className="eyebrow">{rooms.length > 1 ? 'Year rooms' : 'Your year room'} · <b>live</b></span>
          </div>
          {rooms.map((r) => (
            <Link key={r.room} to={`/forum/room/${r.room}`} className="room-row">
              <div>
                <div className="t">{r.label}{r.mine && rooms.length > 1 && <span className="pill orange" style={{ marginLeft: 8 }}>Yours</span>}</div>
                <div className="m">{pluralise(r.members, 'agent')}{r.lastAt ? ` · last message ${timeAgo(r.lastAt)}` : ' · quiet so far'}</div>
              </div>
              <span className="pill teal">Open →</span>
            </Link>
          ))}
          {rooms.length === 1 && <p className="tiny dim" style={{ marginTop: 10 }}>A group chat for everyone in your year. Wrong year? Change it under your file.</p>}
        </div>
      )}

      <div className="cats">
        <button className={`btn xs ${cat === null ? '' : 'ghost'}`} onClick={() => setCat(null)}>All</button>
        {CATS.map(([k, l]) => (
          <button key={k} className={`btn xs ${cat === k ? '' : 'ghost'}`} onClick={() => setCat(k)}>{l}</button>
        ))}
      </div>

      <div className="card">
        {threads === undefined ? (
          <div className="empty"><span className="spin" /></div>
        ) : threads.length === 0 ? (
          <div className="empty">Quiet in here. Start something.</div>
        ) : (
          threads.map((t) => (
            <Link key={t._id} to={`/forum/${t._id}`} className="thread-row">
              <div className="t">{t.pinned && <span className="pill orange" style={{ marginRight: 8 }}>Pinned</span>}{t.title}</div>
              <div className="m">
                <span>@{t.author?.displayHandle ?? '[retired]'}</span>
                <span>{CATS.find(([k]) => k === t.category)?.[1]}</span>
                <span>{pluralise(t.postCount, 'post')}</span>
                <span>{timeAgo(t.lastPostAt)}</span>
                {t.locked && <span>locked</span>}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

function NewThread({ onDone }) {
  const { token } = useSession()
  const create = useMutation(api.forum.createThread)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('general')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function go(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await create({ token, title, body, category })
      onDone()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card bracket" onSubmit={go}>
      <div className="field">
        <label>Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required autoFocus />
      </div>
      <div className="field">
        <label>Category</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Post</label>
        <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required />
      </div>
      {error && <div className="error">{error}</div>}
      <button className="btn" type="submit" disabled={busy} style={{ marginTop: 14 }}>{busy ? <span className="spin" /> : 'Post thread'}</button>
    </form>
  )
}
