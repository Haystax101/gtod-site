import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'
import { errMsg, useSession } from '../lib/session'
import { Avatar, LoyalPill, RankPill } from '../components/Badges'
import { fileNo } from '../lib/format'

export default function Me() {
  const { token, me, logOut } = useSession()
  const settings = useQuery(api.settings.get, {})
  const updateProfile = useMutation(api.agents.updateProfile)
  const changePassword = useAction(api.auth.changePassword)
  const [bio, setBio] = useState(me.bio ?? '')
  const [saved, setSaved] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwMsg, setPwMsg] = useState(null)

  async function saveBio(e) {
    e.preventDefault()
    await updateProfile({ token, bio })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function savePw(e) {
    e.preventDefault()
    setPwMsg(null)
    try {
      await changePassword({ token, ...pw })
      setPw({ current: '', next: '' })
      setPwMsg({ ok: true, text: 'Password changed.' })
    } catch (err) {
      setPwMsg({ ok: false, text: errMsg(err) })
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Agent file <b>№ {fileNo(me._id)}</b></span>
        <h1 className="display">Your file</h1>
      </div>

      <div className="card bracket">
        <div className="idcard">
          <Avatar agent={me} lg />
          <div>
            <div className="name">@{me.displayHandle}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <RankPill rank={me.rank} rankLabel={me.rankLabel} />
              {me.loyal && <LoyalPill />}
            </div>
          </div>
        </div>
        <div className="divider" />
        <form onSubmit={saveBio}>
          <div className="field">
            <label>Cover story <span className="dim">(bio, 200 chars)</span></label>
            <input className="input" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} placeholder="Course, uni, what you're about" />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn sm" type="submit">Save</button>
            {saved && <span className="pill green">Saved</span>}
            <Link to={`/a/${me.handle}`} className="linkbtn small">View as others see it</Link>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-head"><span className="eyebrow">Change password</span></div>
        <form onSubmit={savePw}>
          <div className="field">
            <label>Current</label>
            <input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          </div>
          <div className="field">
            <label>New</label>
            <input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
          </div>
          {pwMsg && <div className={pwMsg.ok ? 'notice teal' : 'error'} style={{ marginTop: 12 }}>{pwMsg.text}</div>}
          <button className="btn sm ghost" type="submit" style={{ marginTop: 12 }}>Update password</button>
        </form>
      </div>

      {settings?.donateUrl && me.rank !== 'lead' && (
        <div className="card">
          <div className="card-head"><span className="eyebrow">Optional</span>{me.loyal && <LoyalPill />}</div>
          <p className="small muted">
            The programme is free and stays free. If you want to chip in towards the podcast, you can, and your file gets the Loyal Agent mark.
            No pressure, no perks locked behind it.
          </p>
          <a className="btn sm ghost" style={{ marginTop: 12 }} href={`${settings.donateUrl}?client_reference_id=${me._id}`} target="_blank" rel="noreferrer">Fund the operation</a>
        </div>
      )}

      <div className="row between">
        <Link to="/terms" className="linkbtn small">Programme rules</Link>
        <button className="btn sm danger" onClick={logOut}>Log out</button>
      </div>
    </div>
  )
}
