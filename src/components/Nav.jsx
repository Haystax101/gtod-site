import { Link, NavLink, useLocation } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'
import { backendConfigured } from '../lib/backend.jsx'

function AuthControls() {
  if (!backendConfigured) return null
  return (
    <div className="nav-auth">
      <SignedOut>
        <SignInButton mode="modal">
          <button type="button" className="btn btn-primary btn-sm">Sign in</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </div>
  )
}

export default function Nav() {
  const { pathname } = useLocation()
  const home = pathname === '/'
  // On the landing page the section links are plain anchors so the browser
  // scrolls natively; from other pages they route back home with the hash.
  const to = (id) => (home ? `#${id}` : `/#${id}`)
  const cls = ({ isActive }) => (isActive ? 'active' : undefined)
  return (
    <header className="site">
      <div className="nav">
        <div className="nav-logo"><img src="/assets/logo.png" alt="Get There One Day logo" /></div>
        <Link className="nav-name" to="/">Get There <span>One Day</span></Link>
        <nav className="links">
          <a className="hide-mobile" href={to('podcast')}>Podcast</a>
          <NavLink to="/apprenticeships" className={cls}>Playbook</NavLink>
          {/* Entry point into the signed-in app. Without a link here the
              timeline, answer bank, practice calls and cohorts were reachable
              only by typing a URL. AppNav takes over once you are inside. */}
          <NavLink to="/timeline" className={cls}>This week</NavLink>
          <NavLink to="/charge" className={({ isActive }) => `charge-link${isActive ? ' active' : ''}`}>
            <span className="wordmark"><span className="cha">cha</span><span className="rge">rge</span></span>
          </NavLink>
          <a className="hide-mobile" href={to('ask')}>Ask the pod</a>
        </nav>
        <AuthControls />
      </div>
    </header>
  )
}
