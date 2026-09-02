/**
 * Tests for the weekly task rules in convex/timeline.ts.
 *
 *   node --experimental-strip-types tools/timeline/rules.test.ts
 *
 * `tasksFor` is pure by design, so these run against the real rules with no
 * Convex database, no auth and no network. If a rule changes, this file is
 * where the argument about it should happen.
 *
 * The one piece of machinery: convex/*.ts uses extensionless relative imports
 * ('./users', './_generated/server'), which Node's ESM resolver will not
 * resolve on its own. The hook below adds the extension back so the module can
 * be loaded as written, rather than making production code awkward to suit a
 * test runner.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL)
      for (const ext of ['.ts', '.js']) {
        const candidate = new URL(base.href + ext)
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
})

const {
  DAY_MS,
  daysUntil,
  effectiveDeadline,
  employerLabel,
  formatDay,
  isClosed,
  tasksFor,
  weekOf,
  weekStart,
} = await import('../../convex/timeline.ts')
const { SCHEME_SEEDS } = await import('../../convex/content/schemes.ts')

type TaskDraft = { title: string; detail?: string; dueAt?: number; repeat: 'once' | 'weekly' }
type Stage = Parameters<typeof isClosed>[0]

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`)
  }
}

// A fixed Wednesday, so every "days away" case is arithmetic and not a surprise.
const NOW = Date.parse('2026-09-02T09:00:00.000Z')
const inDays = (n: number) => NOW + n * DAY_MS
const agoDays = (n: number) => NOW - n * DAY_MS

const DELOITTE = {
  employer: 'Deloitte',
  name: 'School and college leaver apprenticeships',
  verified: false,
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    stage: 'interested' as Stage,
    createdAt: agoDays(1),
    updatedAt: agoDays(1),
    ...overrides,
  } as Parameters<typeof tasksFor>[0]
}

const titles = (drafts: TaskDraft[]) => drafts.map((d) => d.title)
const has = (drafts: TaskDraft[], re: RegExp) => drafts.some((d) => re.test(d.title))

const STAGES: Stage[] = [
  'interested',
  'applying',
  'submitted',
  'online_test',
  'video_interview',
  'assessment_centre',
  'final_interview',
  'offer',
  'rejected',
  'withdrawn',
]

console.log('\nweekOf')
{
  check('a Monday is its own week', weekOf(Date.parse('2026-08-31T12:00:00Z')) === '2026-08-31')
  check('midweek rolls back to Monday', weekOf(Date.parse('2026-09-02T09:00:00Z')) === '2026-08-31')
  check('Sunday belongs to the week that started', weekOf(Date.parse('2026-09-06T23:59:59Z')) === '2026-08-31')
  check('the next Monday starts a new week', weekOf(Date.parse('2026-09-07T00:00:00Z')) === '2026-09-07')
  check('works across a year boundary', weekOf(Date.parse('2027-01-01T12:00:00Z')) === '2026-12-28')
  check('weekStart round-trips', weekOf(weekStart(NOW)) === weekOf(NOW))
  check('weekStart is midnight UTC', new Date(weekStart(NOW)).toISOString() === '2026-08-31T00:00:00.000Z')
  // ISO date strings sort chronologically, which is what makes the by_user_week
  // index usable as a range query for task history.
  check('week strings sort chronologically', weekOf(agoDays(30)) < weekOf(NOW))
}

console.log('\nformatDay and daysUntil')
{
  check('formats a day', formatDay(Date.parse('2026-11-14T00:00:00Z')) === '14 Nov', formatDay(Date.parse('2026-11-14T00:00:00Z')))
  check('no locale surprises in January', formatDay(Date.parse('2027-01-05T23:00:00Z')) === '5 Jan')
  check('a week away is 7 days', daysUntil(inDays(7), NOW) === 7)
  check('later today is 0 days', daysUntil(NOW + 3 * 3600_000, NOW) === 0)
  check('yesterday is negative', daysUntil(agoDays(1), NOW) === -1)
}

console.log('\neffectiveDeadline: never trust an unchecked date')
{
  const unverified = { ...DELOITTE, closesAt: inDays(10), verified: false }
  const verified = { ...DELOITTE, closesAt: inDays(10), verified: true }
  check(
    'an unverified scheme date is ignored',
    effectiveDeadline(application(), unverified) === undefined,
  )
  check('a verified scheme date is used', effectiveDeadline(application(), verified) === inDays(10))
  check(
    "the user's own date beats the scheme's",
    effectiveDeadline(application({ deadlineAt: inDays(2) }), verified) === inDays(2),
  )
  check('no scheme and no date means no deadline', effectiveDeadline(application(), null) === undefined)
  check(
    'an unverified scheme generates no urgency at all',
    !has(tasksFor(application(), unverified, NOW), /submit|closes|deadline/i),
    titles(tasksFor(application(), unverified, NOW)).join(' | '),
  )
}

console.log('\nclosed applications generate nothing')
{
  for (const stage of ['rejected', 'withdrawn'] as Stage[]) {
    check(`${stage} produces no tasks`, tasksFor(application({ stage, deadlineAt: inDays(2) }), DELOITTE, NOW).length === 0)
    check(`${stage} is closed`, isClosed(stage))
  }
  check('interested is not closed', !isClosed('interested'))
}

console.log('\ndeadline distance, at "interested"')
{
  const at = (days: number) => tasksFor(application({ deadlineAt: inDays(days) }), DELOITTE, NOW)

  const threeWeeks = at(21)
  check('three weeks out asks for a draft', has(threeWeeks, /^Draft your application for Deloitte$/), titles(threeWeeks).join(' | '))
  check('the draft task is the first thing shown', /^Draft your application/.test(threeWeeks[0].title))
  check('the draft task repeats weekly', threeWeeks[0].repeat === 'weekly')

  const soon = at(6)
  check('inside a week it says submit this week', has(soon, /^Submit your Deloitte application this week$/), titles(soon).join(' | '))
  check('the urgent task carries the real deadline', soon[0].dueAt === inDays(6))
  check('the urgent task names the closing date', /closes/.test(soon[0].detail ?? ''), soon[0].detail)

  const urgent = at(2)
  check('two days out says submit in 2 days', has(urgent, /^Submit your Deloitte application in 2 days$/), titles(urgent).join(' | '))
  check('one day out says by tomorrow', has(at(1), /by tomorrow$/), titles(at(1)).join(' | '))
  check('today says today', has(at(0), /application today$/), titles(at(0)).join(' | '))

  const far = at(90)
  check('far out it only asks for a calendar entry', has(far, /calendar/i), titles(far).join(' | '))
  check('far out there is no submit-now panic', !has(far, /^Submit/), titles(far).join(' | '))
  check('the calendar task is a once-only', far.find((d) => /calendar/i.test(d.title))?.repeat === 'once')

  const passedDeadline = at(-3)
  check('a passed deadline asks whether it is really closed', has(passedDeadline, /still accepting/i), titles(passedDeadline).join(' | '))
  check('a passed deadline does not tell you to submit', !has(passedDeadline, /^Submit/))

  const noDate = tasksFor(application(), DELOITTE, NOW)
  check('no deadline means go and find one', has(noDate, /closing date/i), titles(noDate).join(' | '))
  check('finding the date is a once-only', noDate.find((d) => /closing date/i.test(d.title))?.repeat === 'once')

  const rolling = tasksFor(application(), { ...DELOITTE, rolling: true }, NOW)
  check('a rolling scheme says apply now', has(rolling, /recruit all year/i), titles(rolling).join(' | '))
}

console.log('\nafter submission the closing date stops being the story')
{
  const submitted = tasksFor(application({ stage: 'submitted', deadlineAt: inDays(2) }), DELOITTE, NOW)
  check('no submit-now task once submitted', !has(submitted, /^Submit your/), titles(submitted).join(' | '))
  check('no draft task once submitted', !has(submitted, /^Draft your/))
}

console.log('\nstage rules')
{
  const applying = tasksFor(application({ stage: 'applying' }), DELOITTE, NOW)
  check('applying: tailor the CV', has(applying, /Tailor your CV to Deloitte/), titles(applying).join(' | '))
  check('applying: write the why-them answer', has(applying, /why Deloitte/))
  check('applying: keeps momentum weekly when nothing is due', applying.some((d) => d.repeat === 'weekly'))

  const online = tasksFor(application({ stage: 'online_test' }), DELOITTE, NOW)
  check('online test: book it', has(online, /^Book your Deloitte online test$/), titles(online).join(' | '))
  check('online test: practise numerical reasoning', has(online, /^Practise numerical reasoning before Deloitte's test$/), titles(online).join(' | '))
  check('online test: practice repeats every week', online.find((d) => /numerical/.test(d.title))?.repeat === 'weekly')
  check('online test: booking is asked for once', online.find((d) => /^Book your/.test(d.title))?.repeat === 'once')

  const onlineSoon = tasksFor(application({ stage: 'online_test', deadlineAt: inDays(4) }), DELOITTE, NOW)
  check('online test with a window: sit it before the date', has(onlineSoon, /Sit your Deloitte online test before \d+ \w+$/), titles(onlineSoon).join(' | '))

  const video = tasksFor(application({ stage: 'video_interview' }), DELOITTE, NOW)
  check('video: record yourself', has(video, /Record yourself/), titles(video).join(' | '))
  check('video: check the kit', has(video, /camera, microphone/))
  check('video: STAR examples', has(video, /STAR/))

  const centre = tasksFor(application({ stage: 'assessment_centre' }), DELOITTE, NOW)
  check('assessment centre: ask what the format is', has(centre, /what their assessment centre involves/), titles(centre).join(' | '))
  check('assessment centre: values matching', has(centre, /values/))
  check('assessment centre: journey planned', has(centre, /journey/))

  const final = tasksFor(application({ stage: 'final_interview' }), DELOITTE, NOW)
  check('final: re-read the application', has(final, /Re-read the application/), titles(final).join(' | '))
  check('final: questions to ask them', has(final, /three questions to ask Deloitte/))

  const offer = tasksFor(application({ stage: 'offer', updatedAt: agoDays(2) }), DELOITTE, NOW)
  check('offer: reply to it', has(offer, /accept or decline/), titles(offer).join(' | '))
  check('offer: check the terms', has(offer, /pay, location, start date/))
  const staleOffer = tasksFor(application({ stage: 'offer', updatedAt: agoDays(40) }), DELOITTE, NOW)
  check('offer: stops nagging after a fortnight', staleOffer.length === 0, titles(staleOffer).join(' | '))
}

console.log('\nstaleness')
{
  const fresh = tasksFor(application({ stage: 'interested', updatedAt: agoDays(2) }), DELOITTE, NOW)
  check('a new interest is not pushed for a decision', !has(fresh, /Decide this week/), titles(fresh).join(' | '))

  const drifting = tasksFor(application({ stage: 'interested', updatedAt: agoDays(25) }), DELOITTE, NOW)
  check('three weeks of drift forces a decision', has(drifting, /^Decide this week: apply to Deloitte, or take it off your list$/), titles(drifting).join(' | '))
  check('the decision task repeats until it moves', drifting.find((d) => /^Decide/.test(d.title))?.repeat === 'weekly')

  const driftingWithDeadline = tasksFor(
    application({ stage: 'interested', updatedAt: agoDays(25), deadlineAt: inDays(30) }),
    DELOITTE,
    NOW,
  )
  check('a real deadline replaces the nudge to decide', !has(driftingWithDeadline, /Decide this week/), titles(driftingWithDeadline).join(' | '))

  const waiting = tasksFor(application({ stage: 'submitted', updatedAt: agoDays(3) }), DELOITTE, NOW)
  check('a fresh submission is left alone', !has(waiting, /junk folder|update/i), titles(waiting).join(' | '))
  check('a fresh submission banks its answers', has(waiting, /answer bank/), titles(waiting).join(' | '))

  const twoWeeks = tasksFor(application({ stage: 'submitted', updatedAt: agoDays(16) }), DELOITTE, NOW)
  check('two weeks of silence: check junk', has(twoWeeks, /junk folder/), titles(twoWeeks).join(' | '))
  check('two weeks of silence: no chasing yet', !has(twoWeeks, /early careers team/))

  const fourWeeks = tasksFor(application({ stage: 'submitted', updatedAt: agoDays(30) }), DELOITTE, NOW)
  check('four weeks of silence: chase them', has(fourWeeks, /^Email Deloitte's early careers team for an update$/), titles(fourWeeks).join(' | '))
}

console.log('\ncustom employers work as well as directory ones')
{
  const custom = tasksFor(
    application({ stage: 'online_test', customEmployer: 'Newcastle City Council' }),
    null,
    NOW,
  )
  check('the custom employer is named in the title', has(custom, /^Book your Newcastle City Council online test$/), titles(custom).join(' | '))
  check('label falls back to the custom employer', employerLabel(application({ customEmployer: 'Aldi' }), null) === 'Aldi')
  check('label prefers the scheme employer', employerLabel(application({ customEmployer: 'Aldi' }), DELOITTE) === 'Deloitte')
  const anonymous = tasksFor(application({ stage: 'applying' }), null, NOW)
  check('a nameless application still produces work', anonymous.length > 0)
}

console.log('\nwritten for a 17-year-old')
{
  // Every generated title across every stage and every deadline distance, so
  // the quality rules below are checked against the whole surface.
  const everyDraft: TaskDraft[] = []
  for (const stage of STAGES) {
    for (const deadline of [undefined, -5, 0, 2, 6, 14, 21, 60]) {
      for (const age of [1, 16, 30]) {
        everyDraft.push(
          ...tasksFor(
            application({
              stage,
              updatedAt: agoDays(age),
              deadlineAt: deadline === undefined ? undefined : inDays(deadline),
            }),
            DELOITTE,
            NOW,
          ),
        )
      }
    }
  }
  check('the sweep actually produced tasks', everyDraft.length > 50, `${everyDraft.length}`)

  const vague = /progress your|work on your application|think about|consider your|keep going|stay on top|make progress/i
  const offenders = everyDraft.filter((d) => vague.test(d.title))
  check('no vague titles', offenders.length === 0, titles(offenders).join(' | '))

  const nameless = everyDraft.filter((d) => !d.title.includes('Deloitte'))
  check('every task names the employer', nameless.length === 0, titles(nameless).join(' | '))

  const tooLong = everyDraft.filter((d) => d.title.length > 100)
  check('titles fit on a phone', tooLong.length === 0, titles(tooLong).join(' | '))

  const badStart = everyDraft.filter((d) => !/^[A-Z]/.test(d.title))
  check('titles start like sentences', badStart.length === 0, titles(badStart).join(' | '))

  const noDetail = everyDraft.filter((d) => !d.detail || d.detail.length < 20)
  check('every task explains itself', noDetail.length === 0, titles(noDetail).join(' | '))

  const jargon = /leverage|utilise|synergy|stakeholder management|circle back/i
  check('no office jargon', !everyDraft.some((d) => jargon.test(d.title) || jargon.test(d.detail ?? '')))
}

console.log('\nbudget and determinism')
{
  for (const stage of STAGES) {
    const drafts = tasksFor(application({ stage, deadlineAt: inDays(5) }), DELOITTE, NOW)
    if (isClosed(stage)) continue
    check(`${stage}: produces at least one task`, drafts.length > 0)
    check(`${stage}: no duplicate titles`, new Set(titles(drafts)).size === drafts.length, titles(drafts).join(' | '))
    // The caller only takes the first few, so the urgent one has to be first.
    if (stage === 'interested' || stage === 'applying') {
      check(`${stage}: the deadline task leads`, /^Submit your/.test(drafts[0].title), drafts[0].title)
    }
  }

  const once = tasksFor(application({ stage: 'applying', deadlineAt: inDays(5) }), DELOITTE, NOW)
  const twice = tasksFor(application({ stage: 'applying', deadlineAt: inDays(5) }), DELOITTE, NOW)
  check('pure: same inputs, same output', JSON.stringify(once) === JSON.stringify(twice))

  const frozen = application({ stage: 'applying', deadlineAt: inDays(5) })
  const before = JSON.stringify(frozen)
  tasksFor(frozen, DELOITTE, NOW)
  check('pure: the application is not mutated', JSON.stringify(frozen) === before)
}

console.log('\nthe seed directory invents nothing')
{
  check('enough employers to be useful', SCHEME_SEEDS.length >= 25, `${SCHEME_SEEDS.length}`)
  check('slugs are unique', new Set(SCHEME_SEEDS.map((s) => s.slug)).size === SCHEME_SEEDS.length)
  check('every row has an employer and a name', SCHEME_SEEDS.every((s) => s.employer && s.name))
  check('every url is https', SCHEME_SEEDS.every((s) => s.url.startsWith('https://')), SCHEME_SEEDS.find((s) => !s.url.startsWith('https://'))?.url)
  // The whole point of the file: it carries no unchecked facts. If someone adds
  // a date, a salary or an entry requirement here, this fails until a human has
  // verified it against the employer's own page.
  const fields = new Set(SCHEME_SEEDS.flatMap((s) => Object.keys(s)))
  const banned = ['opensAt', 'closesAt', 'salary', 'entryRequirements', 'verified', 'verifiedAt']
  check('no dates, salaries or entry requirements in the seed', banned.every((f) => !fields.has(f)), [...fields].join(','))
  check('sectors are set so the directory can be filtered', SCHEME_SEEDS.every((s) => Boolean(s.sector)))
  check('levels are only claimed where the standard fixes them', SCHEME_SEEDS.filter((s) => s.level !== undefined).length <= 3)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
