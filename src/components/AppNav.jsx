import { NavLink } from 'react-router-dom'
import { CalendarDays, MessageSquare, Mic, Sparkles, Users } from 'lucide-react'
import '../styles/appnav.css'

/**
 * Tabs across the signed-in surfaces.
 *
 * Without this each feature is an unlinked URL: the routes existed but nothing
 * pointed at them, so four of the five features were unreachable by clicking.
 * A single bar on every app page is what makes them read as one product.
 *
 * Order is deliberate. Timeline first because it is the weekly reason to come
 * back; Charge last because it is the open-ended thing you reach for when the
 * structured tools have not answered your question.
 */
const TABS = [
  { to: '/timeline', label: 'This week', Icon: CalendarDays },
  { to: '/answers', label: 'Answers', Icon: Sparkles },
  { to: '/interview', label: 'Practice', Icon: Mic },
  { to: '/community', label: 'Cohorts', Icon: Users },
  { to: '/charge', label: 'Ask Charge', Icon: MessageSquare },
]

export default function AppNav() {
  return (
    <nav className="app-nav" aria-label="Your apprenticeship tools">
      <ul>
        {TABS.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) => `app-nav-tab${isActive ? ' is-active' : ''}`}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
