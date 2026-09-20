import { Link, NavLink, Outlet } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar } from './Badges'

const I = {
  brief: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>,
  missions: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>,
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>,
  forum: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.3A8 8 0 1 1 21 12z"/></svg>,
  line: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>,
}

const TABS = [
  { to: '/', label: 'Brief', icon: I.brief, end: true },
  { to: '/missions', label: 'Missions', icon: I.missions },
  { to: '/board', label: 'Board', icon: I.board },
  { to: '/forum', label: 'Forum', icon: I.forum },
  { to: '/line', label: 'Line', icon: I.line },
]

export default function Shell() {
  const { me, token } = useSession()
  const unread = useQuery(api.directLine.unreadForMe, { token: token ?? undefined }) ?? 0
  const isLead = me?.rank === 'lead'

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/assets/logo.png" alt="" />
          <div>
            <div className="name">GTOD <span>Field Ops</span></div>
            <div className="sub">RESTRICTED</div>
          </div>
        </Link>
        <nav className="navlinks">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}>
              {t.label}{t.to === '/line' && unread > 0 ? ` (${unread})` : ''}
            </NavLink>
          ))}
          {isLead && <NavLink to="/hq">HQ</NavLink>}
        </nav>
        <div className="spacer" />
        {isLead && (
          <Link to="/hq" className="pill orange solid" style={{ textDecoration: 'none' }}>HQ</Link>
        )}
        <Link to="/me" className="who" title="Your file">
          <Avatar agent={me} />
          <span className="h">@{me?.displayHandle}</span>
        </Link>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.icon}
            <span>{t.label}</span>
            {t.to === '/line' && unread > 0 && <span className="dot" />}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
