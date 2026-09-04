import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics.js'
import { TikTokIcon, InstagramIcon, SpotifyIcon, YouTubeIcon } from '../components/SocialIcons.jsx'
import { ChargeMark } from '../components/Wordmark.jsx'

const TIKTOK = 'https://www.tiktok.com/@getthereonedaypod'
// TODO: confirm Instagram handle
const INSTAGRAM = 'https://www.instagram.com/getthereoneday'
// TODO: replace with the real Spotify show URL
const SPOTIFY = 'https://open.spotify.com/'
// TODO: replace with the real YouTube channel URL
const YOUTUBE = 'https://www.youtube.com/@getthereoneday'

function PhoneReel() {
  // Until assets/reel.mp4 exists the video errors, so we drop it and the logo fallback shows through.
  const [reelOk, setReelOk] = useState(true)
  return (
    <div className="hero-art">
      <div className="phone">
        <div className="screen">
          <div className="screen-fallback">
            <img src="/assets/favicon.png" alt="Get There One Day logo" />
            <span>@getthereonedaypod</span>
          </div>
          {reelOk && (
            <video
              src="/assets/reel.mp4" autoPlay muted loop playsInline preload="metadata"
              aria-label="Get There One Day TikTok videos"
              onError={() => setReelOk(false)}
            />
          )}
          <div className="island" />
        </div>
      </div>
    </div>
  )
}

function AskCard() {
  const location = useLocation()
  const navigate = useNavigate()
  const submitted = new URLSearchParams(location.search).has('submitted')
  const [nextUrl, setNextUrl] = useState('https://getthereoneday.com/?submitted=1#ask')
  useEffect(() => {
    // Point the post-submit redirect back at wherever the site is hosted
    setNextUrl(`${window.location.origin}${import.meta.env.BASE_URL}?submitted=1#ask`)
  }, [])
  const askAgain = (e) => {
    e.preventDefault()
    navigate('/#ask', { replace: true })
  }
  return (
    <div className="card ask-card">
      <div className="eyebrow">Ask us anything</div>
      <h2>Your question. <span className="hl">Next episode.</span></h2>
      <p>
        Got a question about careers, uni, apprenticeships, money, or getting started?
        Drop it below and it could be answered on the next episode of the podcast.
      </p>
      {submitted ? (
        <div className="thanks">
          Question received. Keep an eye (and ear) on the next episode,
          and follow us on <a href={TIKTOK} target="_blank" rel="noopener">TikTok</a> so you don't miss it.
          <br /><a href="/#ask" onClick={askAgain}>Ask another question →</a>
        </div>
      ) : (
        /* FormSubmit alias for questions@getthereoneday.com (keeps the address out of the page source) */
        <form
          className="ask-form" action="https://formsubmit.co/1dddd710546e4f15ee20a90e5f266333" method="POST"
          onSubmit={() => track('question_submitted')}
        >
          <input type="hidden" name="_subject" value="New podcast question (getthereoneday.com)" />
          <input type="hidden" name="_template" value="table" />
          <input type="hidden" name="_captcha" value="false" />
          <input type="hidden" name="_next" value={nextUrl} />
          <input type="text" name="_honey" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
          <input type="text" name="name" placeholder="Your name or @handle (optional, anonymous is fine)" />
          <textarea
            name="question" required rows={4} maxLength={2000}
            placeholder="What do you want answered on the pod? Careers, uni, apprenticeships, money. Ask anything."
          />
          <button className="btn btn-primary" type="submit">Submit your question</button>
        </form>
      )}
      <p className="ask-alt">
        Prefer DMs? Message us on{' '}
        <a href={TIKTOK} target="_blank" rel="noopener">TikTok</a> or{' '}
        <a href={INSTAGRAM} target="_blank" rel="noopener">Instagram</a>.
      </p>
    </div>
  )
}

export default function Home() {
  return (
    <>
      <section className="hero" id="top">
        <div className="wrap">
          <div>
            <div className="eyebrow">14K+ strong on TikTok</div>
            <h1>The community for ambitious young people <span className="hl">going places</span></h1>
            <p className="lede">
              At uni, at school, at work, or building your own thing. Real talk about getting
              where you want to be, one day at a time. Plus the tools to actually get there.
            </p>
            <div className="cta-row">
              <Link className="btn btn-primary" to="/charge">Try Charge, our apprenticeship assistant</Link>
              <a className="btn btn-secondary" href="#podcast">Listen to the podcast</a>
            </div>
            <div className="pill-row">
              <span className="pill">At uni</span>
              <span className="pill">At school</span>
              <span className="pill">At work</span>
              <span className="pill">Entrepreneurial</span>
              <Link className="pill accent" to="/apprenticeships">★ Degree apprentices</Link>
            </div>
          </div>
          <PhoneReel />
        </div>
      </section>

      <div className="stats">
        <div className="wrap">
          <div className="stat"><div className="num">14K+</div><div className="label">TikTok followers</div></div>
          <div className="stat"><div className="num">100%</div><div className="label">Q&amp;A podcast, your questions</div></div>
          <div className="stat"><div className="num">4</div><div className="label">Platforms: TikTok, IG, Spotify, YouTube</div></div>
        </div>
      </div>

      <section className="section" id="mission">
        <div className="wrap">
          <div className="eyebrow">The mission</div>
          <h2>Putting in the work now so future-you can look back and say it was worth it</h2>
          <p className="copy">
            Wherever you're starting from, you belong here. We're for the ones putting in the
            work now so future-them can look back and say it was worth it: students, earners,
            builders, and especially the ones doing both at once.
          </p>
        </div>
      </section>

      <section className="section alt" id="tools">
        <div className="wrap">
          <div className="eyebrow">Tools for applicants</div>
          <h2>Everything we know about <span className="hl">degree apprenticeships</span>, on tap</h2>
          <p className="copy">
            We've written down what actually moves the needle in the application process, and built an
            assistant that coaches you through it.
          </p>
          <div className="feature-grid">
            <div className="card feature">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ChargeMark />
                <h3>Meet <span className="wordmark"><span className="cha">cha</span><span className="rge">rge</span></span></h3>
              </div>
              <p>Chat to the GTOD assistant about your application. It knows the whole playbook, reviews your CV and cover letter, and coaches rather than writes it for you.</p>
              <div className="chat-preview" aria-hidden="true">
                <div className="u">My CV is 3 pages, is that ok for a degree apprenticeship?</div>
                <div className="a"><span className="charge-mark">C</span><span>Two pages max. Let's work out what to cut: which section is longest right now?</span></div>
              </div>
              <ul className="feature-list">
                <li>Free to start, Pro for £10 a month</li>
                <li>Upload a CV or cover letter for honest, specific feedback</li>
              </ul>
              <Link className="btn btn-primary" to="/charge">Start chatting</Link>
            </div>
            <div className="card feature">
              <h3>The Degree Apprenticeship Playbook</h3>
              <p>The three things to do right now, then exactly what each stage of the process is looking for, with a CV and cover letter template you can copy.</p>
              <ul className="feature-list">
                <li>Quick tips: work experience, tailoring your CV, psychometric practice</li>
                <li>Stage by stage: CV, cover letter, assessment centre, interview</li>
                <li>The interview questions you'll almost certainly get asked</li>
              </ul>
              <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="podcast">
        <div className="wrap">
          <div className="eyebrow">The podcast</div>
          <h2>No scripts. No fluff. <span className="hl">100% your questions.</span></h2>
          <p className="copy">
            The Get There One Day podcast is entirely Q&amp;A. Every episode is built
            from questions sent in by the community: careers, uni vs. apprenticeships,
            money, motivation, starting something of your own. If you're wondering it,
            someone else is too.
          </p>
          <div className="listen-row">
            <a className="btn btn-primary" href={SPOTIFY} target="_blank" rel="noopener">Spotify</a>
            <a className="btn btn-secondary" href={YOUTUBE} target="_blank" rel="noopener">YouTube</a>
          </div>
        </div>
      </section>

      <section className="section" id="ask">
        <div className="wrap"><AskCard /></div>
      </section>

      <section className="section alt" id="follow">
        <div className="wrap">
          <div className="eyebrow">Find us everywhere</div>
          <h2>Join the <span className="hl">community</span></h2>
          <div className="follow-grid">
            <a className="social" href={TIKTOK} target="_blank" rel="noopener">
              <TikTokIcon /><span className="name">TikTok</span><span className="sub">14K+ followers · daily content</span>
            </a>
            <a className="social" href={INSTAGRAM} target="_blank" rel="noopener">
              <InstagramIcon /><span className="name">Instagram</span><span className="sub">Behind the scenes</span>
            </a>
            <a className="social" href={SPOTIFY} target="_blank" rel="noopener">
              <SpotifyIcon /><span className="name">Spotify</span><span className="sub">The Q&amp;A podcast</span>
            </a>
            <a className="social" href={YOUTUBE} target="_blank" rel="noopener">
              <YouTubeIcon /><span className="name">YouTube</span><span className="sub">Full episodes</span>
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
