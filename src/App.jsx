import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import Footer from './components/Footer.jsx'
import Home from './pages/Home.jsx'
import Apprenticeships from './pages/Apprenticeships.jsx'
import { Privacy, Terms } from './pages/Legal.jsx'
import { trackPageview } from './lib/analytics.js'

// The chat app pulls in the markdown renderer and file parsers, so it loads on demand.
const Charge = lazy(() => import('./pages/Charge.jsx'))

// Handles two things a plain HTML page got for free:
//  - jumping to #anchors after a route change (e.g. /apprenticeships -> /#ask)
//  - scrolling to the top when moving between pages with no anchor
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1))
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  useEffect(() => {
    trackPageview()
  }, [pathname])
  return null
}

export default function App() {
  const { pathname } = useLocation()
  const isApp = pathname.startsWith('/charge')
  return (
    <>
      <ScrollManager />
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/apprenticeships" element={<Apprenticeships />} />
        <Route path="/charge" element={<Suspense fallback={<div className="gate"><div className="spinner" /></div>}><Charge /></Suspense>} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<Home />} />
      </Routes>
      {!isApp && <Footer />}
    </>
  )
}
