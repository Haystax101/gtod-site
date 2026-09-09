/**
 * The playbook's CV rules, as something a computer can check.
 *
 * Every rule here comes from what GTOD already tells people in the playbook, so
 * the builder holds a CV to the same standard the guide does rather than to a
 * second, invented one. Keeping them here, pure and free of Convex, means they
 * can be unit tested and reused by the UI to show progress live.
 *
 * These are checks, never rewrites. A CV is the applicant's own words: Charge
 * critiques one and does not write one, and neither does this.
 */

export interface CvLike {
  fullName?: string
  email?: string
  phone?: string
  personalStatement?: string
  targetRole?: string
  roles?: { title: string; bullets: string[] }[]
  internships?: { scheme: string; bullets: string[] }[]
  education?: { qualification: string; detail?: string }[]
  skills?: { tools: string[]; industry: string[]; soft: string[] }
  references?: { name: string }[]
  achievements?: string[]
}

export interface Check {
  id: string
  label: string
  /** Passing is good; failing is advice, never an error. */
  passed: boolean
  detail?: string
}

/** Verbs the playbook asks bullets to start with. Not exhaustive, indicative. */
const ACTION_VERBS = [
  'achieved', 'adapted', 'advised', 'analysed', 'arranged', 'built', 'chaired',
  'coached', 'collaborated', 'conducted', 'coordinated', 'created', 'delivered',
  'designed', 'developed', 'directed', 'drove', 'established', 'exceeded',
  'grew', 'handled', 'implemented', 'improved', 'increased', 'introduced',
  'led', 'managed', 'mentored', 'negotiated', 'operated', 'organised',
  'oversaw', 'planned', 'presented', 'produced', 'ran', 'reduced', 'reported',
  'researched', 'resolved', 'ran', 'scheduled', 'secured', 'set', 'solved',
  'streamlined', 'supervised', 'supported', 'trained', 'volunteered', 'won',
]

const startsWithActionVerb = (bullet: string) => {
  const first = bullet.trim().toLowerCase().split(/[^a-z]+/).filter(Boolean)[0]
  return Boolean(first && ACTION_VERBS.includes(first))
}

/** A digit, a percentage or a money figure anywhere in the line. */
const isQuantified = (bullet: string) => /\d/.test(bullet)

const sentenceCount = (text: string) =>
  text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length

/**
 * Rough page estimate.
 *
 * A CV is a layout, so nothing here can be exact. This counts the material and
 * warns as it approaches two pages rather than claiming a page count it cannot
 * know. Roughly 550 words fills a page at normal CV formatting.
 */
export function estimateWords(cv: CvLike): number {
  const words = (s?: string) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0)
  let total = words(cv.personalStatement)
  for (const r of cv.roles ?? []) total += words(r.title) + r.bullets.reduce((n, b) => n + words(b), 0)
  for (const i of cv.internships ?? []) total += words(i.scheme) + i.bullets.reduce((n, b) => n + words(b), 0)
  for (const e of cv.education ?? []) total += words(e.qualification) + words(e.detail)
  const sk = cv.skills
  if (sk) total += [...sk.tools, ...sk.industry, ...sk.soft].reduce((n, s) => n + words(s), 0)
  total += (cv.achievements ?? []).reduce((n, a) => n + words(a), 0)
  return total
}

export function runChecks(cv: CvLike): Check[] {
  const bullets = [
    ...(cv.roles ?? []).flatMap((r) => r.bullets),
    ...(cv.internships ?? []).flatMap((i) => i.bullets),
  ].filter((b) => b.trim())

  const withVerbs = bullets.filter(startsWithActionVerb).length
  const quantified = bullets.filter(isQuantified).length
  const statementSentences = cv.personalStatement ? sentenceCount(cv.personalStatement) : 0
  const words = estimateWords(cv)
  const educationText = (cv.education ?? []).map((e) => `${e.qualification} ${e.detail ?? ''}`).join(' ')

  return [
    {
      id: 'contact',
      label: 'Name, phone and a professional email at the top',
      passed: Boolean(cv.fullName?.trim() && cv.phone?.trim() && cv.email?.trim()),
      detail: cv.email && /hotmail|gamer|xx|69|420/i.test(cv.email)
        ? 'That address may not read as professional. Firstname.lastname is safest.'
        : undefined,
    },
    {
      id: 'statement',
      label: 'Personal statement of three to five sentences',
      passed: statementSentences >= 3 && statementSentences <= 5,
      detail: cv.personalStatement
        ? `Currently ${statementSentences} sentence${statementSentences === 1 ? '' : 's'}.`
        : 'Not written yet.',
    },
    {
      id: 'grades',
      label: 'A-Level and GCSE grades included',
      passed: /a-?level/i.test(educationText) && /gcse/i.test(educationText),
      detail: 'Predicted grades count, and relevant modules are worth naming.',
    },
    {
      id: 'experience',
      label: 'Part-time work, clubs or volunteering listed',
      passed: (cv.roles?.length ?? 0) > 0,
    },
    {
      id: 'verbs',
      label: 'Bullets start with action verbs',
      passed: bullets.length > 0 && withVerbs >= Math.ceil(bullets.length * 0.7),
      detail: bullets.length ? `${withVerbs} of ${bullets.length} so far.` : 'No bullets yet.',
    },
    {
      id: 'numbers',
      label: 'Achievements quantified where it is honest to',
      passed: bullets.length > 0 && quantified >= Math.ceil(bullets.length * 0.3),
      detail: bullets.length
        ? `${quantified} of ${bullets.length} carry a number. Never invent one.`
        : undefined,
    },
    {
      id: 'skills',
      label: 'Skills cover tools, industry knowledge and soft skills',
      passed: Boolean(cv.skills && cv.skills.tools.length && cv.skills.industry.length && cv.skills.soft.length),
    },
    {
      id: 'references',
      label: 'Two references',
      passed: (cv.references?.length ?? 0) >= 2,
    },
    {
      id: 'length',
      label: 'Fits within two pages',
      passed: words <= 1100,
      detail: `About ${words} words. Two pages is roughly 1100.`,
    },
    {
      id: 'tailored',
      label: 'Aimed at a specific role',
      passed: Boolean(cv.targetRole?.trim()),
      detail: 'The playbook is blunt about this: rewrite it for every application.',
    },
  ]
}
