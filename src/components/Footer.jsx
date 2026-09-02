import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="site">
      <div className="wrap">
        <div className="nav-logo"><img src="/assets/logo.png" alt="" /></div>
        <div className="fine"><b>Get There One Day</b> · © 2026 · One day at a time</div>
        <div className="legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href="mailto:questions@getthereoneday.com">Contact</a>
        </div>
      </div>
    </footer>
  )
}
