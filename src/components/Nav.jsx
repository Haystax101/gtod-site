import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'
import { Menu, X } from 'lucide-react'
import { backendConfigured } from '../lib/backend.jsx'
import { asset } from '../lib/asset.js'

/**
 * Everything reachable from the top of the site.
 *
 * Only a couple of the signed-in tools fit across the bar, so on a phone the
 * rest were reachable only by typing a URL or from inside AppNav. The drawer
 * lists the lot.
 */
const SECTIONS = [
  {
    title: 'Your tools',
    items: [
      { to: '/charge', label: 'Charge', wordmark: true },
      { to: '/timeline', label: 'This week' },
      { to: '/answers', label: 'Answers' },
      { to: '/interview', label: 'Practice' },
      { to: '/community', label: 'Cohorts' },
    ],
  },
  {
    title: 'Get There One Day',
    items: [
      { to: '/apprenticeships', label: 'Playbook' },
      { hash: 'podcast', label: 'Podcast' },
      { hash: 'ask', label: 'Ask the pod' },
    ],
  },
]

const ChargeWord = () => (
  <span className="wordmark"><span className="cha">cha</span><span className="rge">rge</span></span>
)

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
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const home = pathname === '/'

  // On the landing page the section links are plain anchors so the browser
  // scrolls natively; from other pages they route back home with the hash.
  const href = (hash) => (home ? `#${hash}` : `/#${hash}`)
  const cls = ({ isActive }) => (isActive ? 'active' : undefined)

  // Close on navigation, so tapping a link doesn't leave the drawer open.
  useEffect(() => setOpen(false), [pathname])

  // While it is open the drawer owns the screen: nothing scrolls behind it,
  // and escape closes it.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="site">
      <div className="nav">
        <div className="nav-logo"><img src={asset('assets/logo.png')} alt="Get There One Day logo" /></div>
        <Link className="nav-name" to="/">Get There <span>One Day</span></Link>

        {/* The same items as the drawer, so nothing is reachable from only one
            of them. Below the breakpoint this is hidden and the burger takes
            over; above it there is room for the lot and no burger appears. */}
        <nav className="links" aria-label="Main">
          {SECTIONS.flatMap((section) => section.items).map((item) =>
            item.hash ? (
              <a key={item.label} href={href(item.hash)}>{item.label}</a>
            ) : item.wordmark ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `charge-link${isActive ? ' active' : ''}`}
              >
                <ChargeWord />
              </NavLink>
            ) : (
              <NavLink key={item.to} to={item.to} className={cls}>{item.label}</NavLink>
            ),
          )}
        </nav>

        <AuthControls />

        <button
          type="button"
          className="icon-btn nav-burger"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu />
        </button>
      </div>

      {/* Rendered into <body>, not into the header. header.site sets
          backdrop-filter, which makes it the containing block for every
          position:fixed descendant - so inside it the drawer's top/bottom
          resolved against the 64px bar and the panel was one navbar tall with
          the whole menu scrolling inside it. A portal escapes that. */}
      {open && createPortal(
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(false)} />
          <div
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            ref={panelRef}
            tabIndex={-1}
          >
            <div className="drawer-head">
              <span className="drawer-title">Menu</span>
              <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X />
              </button>
            </div>
            <nav className="drawer-body" aria-label="All pages">
              {SECTIONS.map((section) => (
                <div className="drawer-section" key={section.title}>
                  <div className="drawer-label">{section.title}</div>
                  {section.items.map((item) =>
                    item.hash ? (
                      <a key={item.label} href={href(item.hash)} onClick={() => setOpen(false)}>
                        {item.label}
                      </a>
                    ) : (
                      <NavLink key={item.to} to={item.to} className={cls}>
                        {item.wordmark ? <ChargeWord /> : item.label}
                      </NavLink>
                    ),
                  )}
                </div>
              ))}
            </nav>
          </div>
        </>,
        document.body,
      )}
    </header>
  )
}
