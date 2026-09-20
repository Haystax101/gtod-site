import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import Recorder from '../components/Recorder'
import { StatusPill } from '../components/Badges'
import { mmss, stamp } from '../lib/format'

const FREEFORM = '__own__'
const MAX_BYTES = 25 * 1024 * 1024

export default function Missions() {
  const { token } = useSession()
  const challenges = useQuery(api.missions.list, { token })
  const mine = useQuery(api.missions.mine, { token })
  const settings = useQuery(api.settings.get, {})
  const uploadUrl = useMutation(api.missions.uploadUrl)
  const submit = useMutation(api.missions.submit)

  const [picked, setPicked] = useState(null)
  const [ownTitle, setOwnTitle] = useState('')
  const [evidence, setEvidence] = useState(null) // { blob, durationSec, mimeType, name? }
  const [link, setLink] = useState('')
  const [mode, setMode] = useState('record') // record | upload | link
  const [count, setCount] = useState(1)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(0) // bumps per submission; drives the banner and remounts the recorder
  const formRef = useRef(null)

  // Default to the first official mission once they load.
  useEffect(() => {
    if (picked === null && challenges?.length) setPicked(challenges[0]._id)
  }, [challenges, picked])

  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_BYTES) return setError('That file is over 25 MB. Trim it and try again.')
    setError(null)
    setEvidence({ blob: f, mimeType: f.type || 'audio/mp4', name: f.name })
  }

  async function send(e) {
    e.preventDefault()
    setError(null)
    if (mode === 'link' && !link.trim()) return setError('Paste the link first.')
    if (mode !== 'link' && !evidence) return setError(mode === 'record' ? 'Record your evidence first.' : 'Choose a file first.')
    setBusy(true)
    try {
      let storageId
      if (mode !== 'link') {
        const url = await uploadUrl({ token })
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': evidence.mimeType }, body: evidence.blob })
        if (!res.ok) throw new Error('upload failed')
        storageId = (await res.json()).storageId
      }
      await submit({
        token,
        challengeId: picked === FREEFORM ? undefined : picked,
        freeformTitle: picked === FREEFORM ? ownTitle : undefined,
        storageId,
        mimeType: evidence?.mimeType,
        durationSec: evidence?.durationSec,
        link: mode === 'link' ? link.trim() : undefined,
        note: note || undefined,
        claimedCount: count,
      })
      setDone((d) => d + 1)
      setEvidence(null)
      setLink('')
      setNote('')
      setCount(1)
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
        <p className="small">Pick a mission, record it happening, submit. The analyst listens for the line and a reply; verified encounters go on your file and the board.</p>
      </div>

      {done > 0 && !evidence && (
        <div className="card" style={{ borderColor: 'var(--green)' }}>
          <div className="row between">
            <span className="eyebrow"><b style={{ color: 'var(--green)' }}>Received.</b> Evidence is being analysed.</span>
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
              <div className="b">Invented something better? Log it here. Free-form missions always go to HQ for a human verdict.</div>
              {picked === FREEFORM && (
                <input className="input" style={{ marginTop: 10 }} placeholder="Name the mission" value={ownTitle} onChange={(e) => setOwnTitle(e.target.value)} maxLength={80} onClick={(e) => e.stopPropagation()} />
              )}
            </button>
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>02 · Evidence</div>
          <div className="card">
            <div className="cats" style={{ marginBottom: 12 }}>
              {[['record', 'Record now'], ['upload', 'Upload audio'], ['link', 'Paste link']].map(([m, l]) => (
                <button type="button" key={m} className={`btn xs ${mode === m ? '' : 'ghost'}`} onClick={() => { setMode(m); setEvidence(null); setError(null) }}>{l}</button>
              ))}
            </div>

            {mode === 'record' && (
              <>
                <Recorder key={done} onRecording={setEvidence} disabled={busy} />
                <p className="tiny dim" style={{ textAlign: 'center', marginTop: 8 }}>
                  Start recording, then go and ask. Up to {mmss(180)}. Audio only, so nobody's face ends up anywhere.
                </p>
              </>
            )}

            {mode === 'upload' && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <label className="upload">
                  <input type="file" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.webm" onChange={onFile} />
                  {evidence ? `Selected: ${evidence.name}` : 'Choose a voice memo or audio file'}
                </label>
                <p className="tiny dim" style={{ marginTop: 8 }}>Voice Memos on iPhone export as .m4a. 25 MB max.</p>
              </div>
            )}

            {mode === 'link' && (
              <div className="field">
                <label>Public TikTok or unlisted YouTube link</label>
                <input className="input mono" inputMode="url" placeholder="https://www.tiktok.com/@you/video/…" value={link} onChange={(e) => setLink(e.target.value)} />
                <div className="hint">Private TikToks cannot be viewed by HQ, even with the link. Links always wait for a human verdict.</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>03 · The claim</div>
          <div className="card">
            <div className="row between">
              <div>
                <div style={{ fontWeight: 600 }}>Encounters in this recording</div>
                <div className="tiny muted">Each person asked, and answering, counts once.</div>
              </div>
              <div className="counter">
                <button type="button" onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
                <span>{count}</span>
                <button type="button" onClick={() => setCount((c) => Math.min(50, c + 1))}>+</button>
              </div>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Field note <span className="dim">(optional)</span></label>
              <input className="input" placeholder="Where, who, how it went" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {settings && !settings.classifierEnabled && mode !== 'link' && (
          <div className="notice">The analyst is offline right now, so submissions will wait for a human verdict from HQ.</div>
        )}

        <button className="btn block" type="submit" disabled={busy}>
          {busy ? <span className="spin" /> : 'Submit evidence'}
        </button>
      </form>

      <div className="card">
        <div className="card-head">
          <span className="eyebrow">Your submissions</span>
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
  return (
    <div className="sub-row">
      <div className="body">
        <div className="row between">
          <div className="t">{s.title}</div>
          <StatusPill status={s.status} />
        </div>
        <div className="m">
          {stamp(s.createdAt)} · claimed {s.claimedCount}
          {s.status === 'approved' && <> · <span style={{ color: 'var(--green)' }}>verified {s.verifiedCount}</span></>}
          {s.durationSec ? ` · ${mmss(s.durationSec)}` : ''}
          {s.link ? ' · link' : ''}
        </div>
        {s.reviewNote && <div className="note">{s.reviewNote}</div>}
        {s.status === 'pending' && s.verdict && (
          <div className="note">The analyst was not sure. HQ will listen and decide.</div>
        )}
        {s.transcript && (
          <details className="more" style={{ marginTop: 6 }}>
            <summary>What the analyst heard</summary>
            <div className="transcript">{s.transcript}</div>
          </details>
        )}
      </div>
    </div>
  )
}
