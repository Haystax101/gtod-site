import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ExternalLink, Copy, ClipboardCheck } from 'lucide-react'
import { track } from '../lib/analytics.js'
import '../styles/apprenticeships.css'

const TIKTOK = 'https://www.tiktok.com/@getthereonedaypod'

const STAGES = [
  { id: 'cv', n: '01', title: 'CV', short: 'Two pages, clean, scannable' },
  { id: 'cover-letter', n: '02', title: 'Cover letter', short: 'One page, real examples' },
  { id: 'assessment-centre', n: '03', title: 'Assessment centre', short: 'Teamwork on show' },
  { id: 'interview', n: '04', title: 'Interview', short: 'In person or online' },
]

const QUICK_TIPS = [
  {
    n: '01',
    title: 'Work experience, work experience, work experience',
    body: (
      <>
        The biggest thing that will set you apart in the degree apprenticeship application
        process is <strong>work experience</strong>: anything with any relevance to what you're
        applying to. Forage and Springpod are great places to find virtual job simulations, a
        good supplement to in-person work experience that helps bulk up your CV. Bright Network,
        Prospects and Careerbay can help you get in-person opportunities.
      </>
    ),
    linksLabel: 'Where to look',
    links: [
      { name: 'Forage', href: 'https://www.theforage.com/', note: 'virtual' },
      { name: 'Springpod', href: 'https://www.springpod.com/', note: 'virtual' },
      { name: 'Bright Network', href: 'https://www.brightnetwork.co.uk/', note: 'in person' },
      { name: 'Prospects', href: 'https://www.prospects.ac.uk/', note: 'in person' },
      { name: 'Careerbay', href: 'https://careerbay.co.uk/', note: 'in person' },
    ],
  },
  {
    n: '02',
    title: 'Change that CV',
    body: (
      <>
        As laborious as it might sound, you need to <strong>tweak your CV for every single
        apprenticeship</strong> you apply to. Look in the job description and pick out some
        keywords to include. In a lot of cases your CV will be scanned by AI, and there will be
        buzzwords it's looking out for.
      </>
    ),
  },
  {
    n: '03',
    title: 'Practice makes perfect',
    body: (
      <>
        At some point in the application process you will have to do some sort of
        <strong> psychometric test</strong>. They are often incredibly difficult and you need
        to be prepared. The National Careers Service has some good practice tests, as does
        psychometrictests.org.
      </>
    ),
    linksLabel: 'Practice tests',
    links: [
      { name: 'National Careers Service', href: 'https://nationalcareers.service.gov.uk/' },
      { name: 'psychometrictests.org', href: 'https://www.psychometrictests.org/' },
    ],
  },
]

const CV_POINTS = [
  <>Keep to a <strong>maximum of two pages</strong> and make sure it's clean, scannable and formatted professionally.</>,
  <>Full name, phone number and a <strong>professional email address</strong> at the very top.</>,
  <><strong>Personal statement:</strong> a brief, 3 to 5 sentence introduction outlining who you are and a couple of key things about you. This is a good chance to get some of those buzzwords in.</>,
  <>Get your <strong>A-Level grades</strong> (or predicted grades) and GCSE grades in there. Any modules from your A-Levels, BTEC etc. that are relevant to the apprenticeship are definitely worth including.</>,
  <>Include <strong>part-time jobs, clubs and volunteering</strong> as well as direct industry experience from work experience placements. Start bullet points with action verbs and quantify achievements wherever possible. <em>Only where appropriate, and don't lie about these, because that looks terrible.</em></>,
  <>Focus on skills and achievements that show <strong>core transferable competencies</strong>: time management, organisation, problem-solving, teamwork. Try to align these with the company's values.</>,
]

const COVER_POINTS = [
  <>Keep your letter to a <strong>maximum of one page</strong> in Word. Cut less impactful sentences if it runs over.</>,
  <>Include contact details and a clean format with <strong>professional margins and font</strong>.</>,
  <>If it's available, try to find the <strong>name of the person who'll be reading it</strong> (sometimes the hiring manager's name is in the job description) and address it to them. Failing that, "Dear Hiring Manager" is fine.</>,
  <>Avoid clichés like <em>"I always give 110%"</em>. Focus on <strong>real-life examples</strong> instead.</>,
]

const AC_POINTS = [
  <>The key thing is to actively demonstrate <strong>teamwork, clear communication and alignment with the company's values</strong> throughout the day.</>,
  <>Share ideas clearly and confidently, but <strong>always allow space for others to speak</strong>. Enough to show confidence and leadership potential, not enough to look arrogant or dominating.</>,
  <><strong>Listen actively</strong> to the suggestions from others, then try to build off them.</>,
  <>The pre-task brief will give you a lot of information, probably some facts and figures. <strong>Use and refer to as many of these as you can</strong> in the final answer, to show you're genuinely engaged and can use information effectively.</>,
]

const INTERVIEW_POINTS = [
  <>Whether online or in person, <strong>be a few minutes early</strong>. Dress appropriately either way: better overdressed than underdressed. Put some time and effort into your appearance and presentation. If it's in person, bring a printout of your CV in a poly pocket or a nice envelope.</>,
  <><strong>Hold eye contact and smile a lot.</strong> Sometimes interviewers deliberately leave a silence at the beginning of the interview to see if you can fill it. Make sure you do.</>,
  <>Research the company's <strong>mission, values, ESG initiatives and recent projects</strong>, and refer to them in the interview, especially when they inevitably ask why you want to work there.</>,
  <>At the end they'll ask if you've got any questions. <strong>Always ask them questions.</strong> It shows you genuinely care about the job and want to know more about it.</>,
]

const ASK_THEM = [
  'What are your favourite things about working for the company?',
  'What does success look like in the role?',
  'Are there any answers I’ve given today that you’d like me to clarify further?',
]

const COMMON_QUESTIONS = [
  'Why did you apply to this firm over others in the industry?',
  'Tell me about a time you had to show resilience or overcome a challenge.',
  'What makes you want to follow the degree apprenticeship route over something more traditional like uni?',
  'Tell me about a time where you had to adapt your approach.',
  'Tell me about a time you worked well in a team.',
]

// Plain-text versions for the copy buttons. Placeholders are in [SQUARE BRACKETS].
const CV_TEXT = `[NAME]
[emailaddress@email.com] | [PHONE NUMBER]

I am a personable and detail-oriented professional with experience in management, customer service and sales. My people skills, combined with my proactive approach and commitment to high standards, align with my strong interest in pursuing a career in sales. I am eager to leverage my diverse experience and skills to contribute to company and client success.

PREVIOUS ROLES AND EXPERIENCE
[PART TIME ROLE] | [COMPANY] | [DATE - DATE]
- 3 or 4 bullet points about what you did in the role that aligns with the job requirements
[PART TIME ROLE] | [COMPANY] | [DATE - DATE]
- 3 or 4 bullet points about what you did in the role that aligns with the job requirements
[PART TIME ROLE] | [COMPANY] | [DATE - DATE]
- 3 or 4 bullet points about what you did in the role that aligns with the job requirements

INTERNSHIPS
[SCHEME TITLE] | [COMPANY] | [DATE]
- e.g. developed and presented comprehensive financial reports using metrics such as revenue growth and liquidity ratios to support client decision making
[SCHEME TITLE] | [COMPANY] | [DATE]
- e.g. conducted data analysis and research, market sizing exercises, developed recommendations, presented results to clients and participated in client meetings
[SCHEME TITLE] | [COMPANY] | [DATE]
- e.g. built relationships with prospective clients, developing effective sales techniques and engagement skills

EDUCATION
- A-Levels: Subject + Grade, Subject + Grade, Subject + Grade | School Name | Date - Date
- GCSEs: Maths Grade, English Language Grade, Sciences Grades, Highest Grade, Second Highest Grade | School | Date - Date

SKILLS
- Tools and technologies: Microsoft Excel, Microsoft Word, Microsoft PowerPoint, Canva, LEAP, Perfect Portal
- Industry knowledge: project management, customer service, finance, administration, event management, legal experience, sales
- Soft skills: adaptability, problem-solving and critical thinking, interpersonal skills, leadership, team working, active listening, communication, time management, resource allocation

REFERENCES
- Reference 1, Job Title, Company, email address
- Reference 2, Job Title, Company, email address

ACHIEVEMENTS
- E.g. prizes won at / with school, Young Enterprise, Sport, Debating etc.
`

const COVER_TEXT = `[NAME]
[ADDRESS]
[PHONE NUMBER]
[emailaddress@email.com]

Dear Hiring Manager,

I am writing to express my interest in the [JOB TITLE] Degree Apprenticeship at [COMPANY]. I am currently in year 13, planning to complete my A-Levels in June 2026, and I heard about this opening at a recent networking event I attended. Following this conversation, I was excited by the opportunity to contribute to the continued success of [COMPANY] while gaining invaluable skills in [SKILLS SPECIFIC TO THE APPRENTICESHIP].

[COMPANY]'s values of [VALUE 1 (E.G. ACCOUNTABILITY)], [VALUE 2], [VALUE 3], [VALUE 4] strongly resonate with my experiences and ambitions. Having balanced part-time work in customer-facing roles with full-time education since the age of 14, I have taken [ACCOUNTABILITY] for my own personal and professional development while honing my interpersonal and customer service skills, helping me to meet your values of [VALUE 2] and [VALUE 3] in all my interactions. Moreover, captaining my School's football 1st XI to regional and national success, I have emphasised collaboration and support, mirroring your values of [VALUE 2] and [VALUE 4] of the responsibility placed on my shoulders.

Furthermore, my diverse work experience placements, including my Commercial and Business Banking Insight at Lloyds, has strengthened my analytical, numerical and communication skills. These experiences have taught me the value of building connections and demonstrate my own personal desire to grow and improve.

I am particularly drawn to [COMPANY]'s proactive ESG initiatives and the support of [CHARITY] in achieving its goal to [EXAMPLE OF GOAL]. My passion for supporting the community and young people's growth led me to [EXAMPLE OF CHARITABLE THING YOU'VE DONE] and I would be keen to make a positive societal impact while growing professionally at [COMPANY].

I am confident that my work ethic, experience, leadership skills and alignment with [COMPANY]'s values make me a strong candidate for this apprenticeship. I would welcome the opportunity to further discuss how I can contribute to [COMPANY]'s continued success.

Thank you for reading my cover letter and considering my application.

Yours sincerely,
[NAME]
`

function CopyButton({ text, label, event }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      track(event)
      setTimeout(() => setDone(false), 2200)
    } catch {
      // Clipboard blocked (older browser / insecure context): fall back to a selectable window
      window.prompt('Copy the template:', text)
    }
  }
  return (
    <button type="button" className={`copy-btn${done ? ' done' : ''}`} onClick={copy}>
      {done ? <ClipboardCheck /> : <Copy />}
      {done ? 'Copied' : label}
    </button>
  )
}

function Checklist({ items }) {
  return (
    <div className="checklist">
      {items.map((item, i) => (
        <div className="check" key={i}>
          <span className="ico"><Check /></span>
          <p>{item}</p>
        </div>
      ))}
    </div>
  )
}

function DocToolbar({ tag, text, label, event }) {
  return (
    <div className="doc-toolbar">
      <div className="eyebrow">{tag}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="doc-legend"><i /> Fill in for the role</span>
        <CopyButton text={text} label={label} event={event} />
      </div>
    </div>
  )
}

function CvExample() {
  const Role = () => (
    <>
      <div className="role"><mark>Part time role</mark> | <mark>Company</mark> | <mark>Date – Date</mark></div>
      <ul><li><i>3 or 4 bullet points about what you did in the role that aligns with the job requirements</i></li></ul>
    </>
  )
  return (
    <div className="doc-wrap">
      <DocToolbar tag="Example of a good CV" text={CV_TEXT} label="Copy CV template" event="cv_template_copied" />
      <div className="paper">
        <div className="name"><mark>Name</mark></div>
        <div className="contact"><mark>emailaddress@email.com</mark> | <mark>Phone number</mark></div>
        <p className="cv-intro">
          I am a personable and detail-oriented professional with experience in management, customer
          service and sales. My people skills, combined with my proactive approach and commitment to
          high standards, align with my strong interest in pursuing a career in sales. I am eager to
          leverage my diverse experience and skills to contribute to company and client success.
        </p>
        <h4>Previous roles and experience</h4>
        <Role /><Role /><Role />
        <h4>Internships</h4>
        <div className="role"><mark>Scheme title</mark> | <mark>Company</mark> | <mark>Date</mark></div>
        <ul><li><i>Some corporate jargon, e.g.</i> developed and presented comprehensive financial reports using metrics such as revenue growth and liquidity ratios to support client decision making</li></ul>
        <div className="role"><mark>Scheme title</mark> | <mark>Company</mark> | <mark>Date</mark></div>
        <ul><li><i>Some corporate jargon, e.g.</i> conducted data analysis and research, market sizing exercises, developed recommendations, presented results to clients and participated in client meetings</li></ul>
        <div className="role"><mark>Scheme title</mark> | <mark>Company</mark> | <mark>Date</mark></div>
        <ul><li><i>Some corporate jargon, e.g.</i> built relationships with prospective clients, developing effective sales techniques and engagement skills</li></ul>
        <h4>Education</h4>
        <ul>
          <li>A-Levels: Subject + Grade, Subject + Grade, Subject + Grade | School Name | Date – Date</li>
          <li>GCSEs: Maths Grade, English Language Grade, Sciences Grades, Highest Grade, Second Highest Grade | School | Date – Date</li>
        </ul>
        <h4>Skills</h4>
        <ul>
          <li>Tools and technologies: Microsoft Excel, Microsoft Word, Microsoft PowerPoint, Canva, LEAP, Perfect Portal</li>
          <li>Industry knowledge: project management, customer service, finance, administration, event management, legal experience, sales</li>
          <li>Soft skills: adaptability, problem-solving and critical thinking, interpersonal skills, leadership, team working, active listening, communication, time management, resource allocation</li>
        </ul>
        <div className="two-col">
          <div>
            <h4>References</h4>
            <ul>
              <li>Reference 1, Job Title, Company, email address</li>
              <li>Reference 2, Job Title, Company, email address</li>
            </ul>
          </div>
          <div>
            <h4>Achievements</h4>
            <ul><li>E.g. prizes won at / with school, Young Enterprise, Sport, Debating etc.</li></ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function CoverLetterExample() {
  return (
    <div className="doc-wrap">
      <DocToolbar tag="Example of a good cover letter" text={COVER_TEXT} label="Copy letter template" event="cover_letter_template_copied" />
      <div className="paper letter">
        <div className="letter-head">
          <mark>Name</mark><br /><mark>Address</mark><br /><mark>Phone number</mark><br /><mark>emailaddress@email.com</mark>
        </div>
        <p>Dear Hiring Manager,</p>
        <p>
          I am writing to express my interest in the <mark>Job title</mark> Degree Apprenticeship at <mark>Company</mark>.
          I am currently in year 13, planning to complete my A-Levels in June 2026, and I heard about this
          opening at a recent networking event I attended. Following this conversation, I was excited by the
          opportunity to contribute to the continued success of <mark>Company</mark> while gaining invaluable
          skills in <mark>skills specific to the apprenticeship</mark>.
        </p>
        <p>
          <mark>Company's</mark> values of <mark>value 1 (e.g. accountability), value 2, value 3, value 4</mark> strongly
          resonate with my experiences and ambitions. Having balanced part-time work in customer-facing roles with
          full-time education since the age of 14, I have taken <mark>accountability</mark> for my own personal and
          professional development while honing my interpersonal and customer service skills, helping me to meet
          your values of <mark>value 2</mark> and <mark>value 3</mark> in all my interactions. Moreover, captaining my
          School's football 1st XI to regional and national success, I have emphasised collaboration and support,
          mirroring your values of <mark>value 2</mark> and <mark>value 4</mark> of the responsibility placed on my shoulders.
        </p>
        <p>
          Furthermore, my diverse work experience placements, including my Commercial and Business Banking
          Insight at Lloyds, has strengthened my analytical, numerical and communication skills. These experiences
          have taught me the value of building connections and demonstrate my own personal desire to grow and improve.
        </p>
        <p>
          I am particularly drawn to <mark>Company's</mark> proactive ESG initiatives and the support of <mark>charity</mark> in
          achieving its goal to <mark>example of goal</mark>. My passion for supporting the community and young people's
          growth led me to <mark>example of charitable thing you've done</mark> and I would be keen to make a positive
          societal impact while growing professionally at <mark>Company</mark>.
        </p>
        <p>
          I am confident that my work ethic, experience, leadership skills and alignment with <mark>Company's</mark> values
          make me a strong candidate for this apprenticeship. I would welcome the opportunity to further discuss how
          I can contribute to <mark>Company's</mark> continued success.
        </p>
        <p>Thank you for reading my cover letter and considering my application.</p>
        <p>Yours sincerely,<br /><span className="sign"><mark>Name</mark></span></p>
      </div>
      <p className="doc-note">
        The orange words are for you to fill in depending on what you're applying to, but it's a good template.
      </p>
    </div>
  )
}

function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean)
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the topmost section currently intersecting the upper part of the viewport
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [ids])
  return active
}

const NAV_IDS = ['quick-tips', ...STAGES.map((s) => s.id)]

export default function Apprenticeships() {
  const active = useActiveSection(NAV_IDS)
  useEffect(() => {
    const prev = document.title
    document.title = 'The Degree Apprenticeship Playbook | Get There One Day'
    return () => { document.title = prev }
  }, [])

  return (
    <>
      <section className="guide-hero" id="top">
        <div className="wrap">
          <div>
            <div className="eyebrow">Free guide · degree apprenticeships</div>
            <h1>The Degree Apprenticeship <span className="hl">Playbook</span></h1>
            <p className="lede">
              Everything we wish someone had told us before applying. <strong>Three things to do
              right now</strong>, then exactly what each stage of the process is looking for, with
              a CV and cover letter template you can copy.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary" href="#quick-tips">Start with the quick tips</a>
              <a className="btn btn-secondary" href="#cv">Skip to the stages</a>
            </div>
          </div>
          <div className="route-card">
            <div className="eyebrow">Stage by stage</div>
            <div className="route">
              {STAGES.map((s) => (
                <a className="route-step" href={`#${s.id}`} key={s.id}>
                  <span className="dot">{s.n}</span>
                  <span>
                    <div className="t">{s.title}</div>
                    <div className="s">{s.short}</div>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="stage-nav" aria-label="Jump to a section">
        <div className="wrap">
          <a href="#quick-tips" className={`quick${active === 'quick-tips' ? ' active' : ''}`}>
            <span className="n">★</span> Quick tips
          </a>
          {STAGES.map((s) => (
            <a href={`#${s.id}`} key={s.id} className={active === s.id ? 'active' : undefined}>
              <span className="n">{s.n}</span> {s.title}
            </a>
          ))}
        </div>
      </div>

      <section className="tips" id="quick-tips">
        <div className="wrap">
          <div className="eyebrow">Quick tips</div>
          <h2>Three things that <span className="hl">actually set you apart</span></h2>
          <p className="copy">
            Do these before you even open an application form.
          </p>
          <div className="tips-grid">
            {QUICK_TIPS.map((t) => (
              <article className="tip" key={t.n}>
                <div className="num">{t.n}</div>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
                {t.links && (
                  <>
                    <div className="links-label">{t.linksLabel}</div>
                    <div className="pills">
                      {t.links.map((l) => (
                        <a className="pill-link" href={l.href} target="_blank" rel="noopener" key={l.name}>
                          {l.name}{l.note ? ` · ${l.note}` : ''} <ExternalLink />
                        </a>
                      ))}
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="stage" id="cv">
        <div className="wrap">
          <div className="stage-head">
            <div className="stage-num">01</div>
            <div>
              <h2>Your <span className="hl">CV</span></h2>
              <p className="sub">Two pages maximum. Clean, scannable, and rewritten for every role you apply to.</p>
            </div>
          </div>
          <div className="stage-body">
            <Checklist items={CV_POINTS} />
            <CvExample />
          </div>
        </div>
      </section>

      <section className="stage" id="cover-letter">
        <div className="wrap">
          <div className="stage-head">
            <div className="stage-num">02</div>
            <div>
              <h2>The <span className="hl">cover letter</span></h2>
              <p className="sub">One page. Real examples over clichés. Addressed to a real person if you can find one.</p>
            </div>
          </div>
          <div className="stage-body">
            <Checklist items={COVER_POINTS} />
            <CoverLetterExample />
          </div>
        </div>
      </section>

      <section className="stage" id="assessment-centre">
        <div className="wrap">
          <div className="stage-head">
            <div className="stage-num">03</div>
            <div>
              <h2>The <span className="hl">assessment centre</span></h2>
              <p className="sub">A full day of showing, not telling: teamwork, communication and the company's values.</p>
            </div>
          </div>
          <div className="stage-body">
            <Checklist items={AC_POINTS} />
            <div className="callout">
              <div className="eyebrow">The talking rule</div>
              <div className="big-stat"><span className="n">~30%</span><span className="l">of the speaking</span></div>
              <p>
                If there are <strong>four of you in a group</strong>, you want to be doing roughly 30% of
                the talking. Enough to show confidence and leadership potential, but not enough to look
                arrogant or dominating. Listen, then build on what others say.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="stage" id="interview">
        <div className="wrap">
          <div className="stage-head">
            <div className="stage-num">04</div>
            <div>
              <h2>The <span className="hl">interview</span></h2>
              <p className="sub">In person or online, the same rules apply: early, prepared, and genuinely curious.</p>
            </div>
          </div>
          <div className="stage-body">
            <Checklist items={INTERVIEW_POINTS} />
            <div className="callout">
              <div className="eyebrow">Always ask them questions</div>
              <p>Some of our personal favourites to ask at the end:</p>
              <div className="ask-them">
                {ASK_THEM.map((q) => <div className="say" key={q}>“{q}”</div>)}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 48 }}>
            <div className="eyebrow">Be ready for these</div>
            <h3 style={{ fontSize: '1.4rem' }}>
              The most commonly asked <span className="hl">degree apprenticeship interview questions</span>
            </h3>
            <div className="q-grid">
              {COMMON_QUESTIONS.map((q, i) => (
                <div className="q" key={q}>
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <p>{q}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="guide-cta">
        <div className="wrap">
          <div className="card ask-card">
            <div className="eyebrow">Still wondering something?</div>
            <h2>Ask <span className="wordmark"><span className="cha">cha</span><span className="rge">rge</span></span>, or ask the pod</h2>
            <p>
              Charge is our assistant that knows this whole playbook and can go through your CV with you.
              Or send your question in and we'll answer it on the next episode.
            </p>
            <div className="cta-row" style={{ justifyContent: 'center' }}>
              <Link className="btn btn-primary" to="/charge">Ask Charge instead</Link>
              <Link className="btn btn-secondary" to="/#ask">Send it to the pod</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
