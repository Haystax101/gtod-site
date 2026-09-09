/**
 * Tests for the pure coaching logic in convex/coach.ts - the answer-reuse
 * matcher and the STAR signal reader - plus the output parsers in
 * convex/coachPrompts.ts.
 *
 *   node --experimental-strip-types tools/coach/reuse.test.ts
 *
 * These are the parts of coaching that must be right without a model call.
 * `suggestAnswerReuse` runs every time a student opens a new application form,
 * so it can never cost a model call, which means the matching quality is
 * entirely down to the code below.
 *
 * ---------------------------------------------------------------------------
 * Why the loader hook
 * ---------------------------------------------------------------------------
 * Everything in convex/ imports its siblings without a file extension
 * ("./users", "./_generated/server"), because Convex bundles with esbuild and
 * esbuild resolves those. Node's ESM resolver does not. convex/retrieval.ts has
 * no relative imports at all, which is why tools/corpus/retrieval.test.ts can
 * import it directly; convex/coach.ts necessarily imports the Convex server
 * helpers, so it cannot.
 *
 * Rather than move the pure logic out of the module it belongs to, this
 * registers a resolver that retries a failed relative specifier with .ts and
 * .js. It affects nothing but this test process.
 */
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context)
        } catch (err) {
          if (specifier.startsWith('.')) {
            for (const ext of ['.ts', '.js']) {
              try { return await next(specifier + ext, context) } catch {}
            }
          }
          throw err
        }
      }
    `),
  import.meta.url,
)

const {
  detectCompetencyFamily,
  matchAnswersForCompetency,
  starSignals,
  FAMILY_LABELS,
} = await import('../../convex/coach.ts')
const { parseCritique, parseDebrief, parseCompetitiveness } = await import(
  '../../convex/coachPrompts.ts'
)

type ReuseCandidate = Parameters<typeof matchAnswersForCompetency>[1][number]
type ReuseMatch = ReturnType<typeof matchAnswersForCompetency>[number]

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

// ---------------------------------------------------------------------------
// Fixtures: answers of the kind a 17 year old actually banks, including the
// half-finished ones, because those are the ones the matcher has to be honest
// about.
// ---------------------------------------------------------------------------

const DAY = 86_400_000
const now = 1_760_000_000_000

const teamwork: ReuseCandidate = {
  _id: 'a_teamwork',
  competency: 'Teamwork',
  prompt: 'Tell us about a time you worked in a team to achieve a goal.',
  body:
    'For my Duke of Edinburgh silver expedition I was in a group of six planning a two day route across the Peak District. ' +
    'Two of the group wanted a longer route than I thought we could carry kit for, so I mapped both options against our ' +
    'estimated walking pace and showed the difference in hours. I took on navigation myself and rebuilt the route around ' +
    'three checkpoints. I checked each leg the night before and briefed the group each morning. We came in 40 minutes ' +
    'ahead of our planned finish on day two, and the assessor picked out my navigation notes as the reason. I have used ' +
    'the same checkpoint method on two group projects since.',
  starComplete: true,
  updatedAt: now - 2 * DAY,
}

const leadership: ReuseCandidate = {
  _id: 'a_leadership',
  competency: 'Leadership',
  prompt: 'Describe a situation where you led others.',
  body:
    'I was made captain of the year 12 netball team after our previous captain left. Attendance at training had dropped to ' +
    'about half the squad. I asked each player individually what was stopping them coming, and the answer was mostly the ' +
    'clash with the late bus. I moved training 30 minutes earlier and set up a rota so nobody had to travel alone. ' +
    'I ran the warm up myself each week so sessions started on time. Attendance went from 7 players to 12 within a month ' +
    'and we won 4 of our last 6 fixtures.',
  starComplete: true,
  updatedAt: now - 10 * DAY,
}

const problemSolving: ReuseCandidate = {
  _id: 'a_problem',
  competency: 'Problem solving',
  prompt: 'Give an example of a difficult problem you solved.',
  body:
    'The till system at the cafe I work in kept double charging card payments on busy Saturdays. I logged every occurrence ' +
    'for two weeks and noticed all of them happened when the card reader was reconnected mid transaction. I tested it ' +
    'deliberately, confirmed the pattern and wrote it up for the owner with the timestamps. She sent it to the supplier ' +
    'and the fix meant we stopped issuing refunds, which had been about 15 pounds a week.',
  starComplete: true,
  updatedAt: now - 30 * DAY,
}

// Deliberately unfinished: a real Situation and Action, no Result, no numbers.
// The matcher must still surface it for resilience and must say what is wrong.
const resilience: ReuseCandidate = {
  _id: 'a_resilience',
  competency: 'Resilience',
  prompt: 'Tell us about a setback and how you dealt with the pressure.',
  body:
    'I failed my first maths mock and it knocked me. We had a lot going on and I had not revised properly for it. ' +
    'I went back through the paper with my teacher and started doing past papers every week instead of rereading notes.',
  starComplete: false,
  updatedAt: now - 1 * DAY,
}

const commercial: ReuseCandidate = {
  _id: 'a_commercial',
  competency: 'Commercial awareness',
  prompt: 'Why this sector, and what is happening in it right now?',
  body:
    'I follow the retail banking sector because of how quickly the branch network is changing. I read the trade press ' +
    'weekly and I tracked one bank closing 100 branches while spending on its app. I wrote up what that meant for the ' +
    'apprentices they hire and used it in a school careers talk I gave to year 10.',
  starComplete: true,
  updatedAt: now - 60 * DAY,
}

const BANK = [teamwork, leadership, problemSolving, resilience, commercial]

const byId = (matches: ReuseMatch[], id: string) => matches.find((m) => m.answerId === id)
const ids = (matches: ReuseMatch[]) => matches.map((m) => m.answerId).join(',')

// ---------------------------------------------------------------------------

console.log('\nstarSignals')
{
  const complete = starSignals(teamwork.body)
  check('spots a real result', complete.hasResult)
  check('spots a number', complete.hasNumbers)
  check('reads first-person ownership high', complete.ownership > 0.5, String(complete.ownership))
  check('calls a finished answer complete', complete.complete)

  const thin = starSignals(resilience.body)
  check('no result phrase means not complete', !thin.complete)
  check('and says why: no result', !thin.hasResult)

  const teamVoice = starSignals(
    'We were asked to run the charity day. We split the jobs between us and we all sold tickets. ' +
      'As a result we raised 500 pounds for the local hospice, which was 20% more than the year before.',
  )
  check('has a result', teamVoice.hasResult)
  check('has numbers', teamVoice.hasNumbers)
  check('flags a "we" answer as low ownership', teamVoice.ownership < 0.5, String(teamVoice.ownership))
  check('so it is not complete despite the result', !teamVoice.complete)

  const noPeople = starSignals('The project finished on time.')
  check('no person words scores zero ownership, not NaN', noPeople.ownership === 0)
  check('empty body is safe', starSignals('').words === 0 && !starSignals('').complete)
  check(
    'does not mistake "the result we wanted" for a result',
    !starSignals('As a team we got the result we wanted in the competition.').hasResult,
  )
}

console.log('\ndetectCompetencyFamily')
{
  check('teamwork label', detectCompetencyFamily('Teamwork') === 'teamwork')
  check(
    'employer synonym maps to the same family',
    detectCompetencyFamily('Collaborating to deliver') === 'teamwork',
    String(detectCompetencyFamily('Collaborating to deliver')),
  )
  check(
    '"working with others" maps to teamwork',
    detectCompetencyFamily('Working with others') === 'teamwork',
    String(detectCompetencyFamily('Working with others')),
  )
  check('leadership', detectCompetencyFamily('Leading and motivating a team') === 'leadership',
    String(detectCompetencyFamily('Leading and motivating a team')))
  check(
    'problem solving from a question, not a label',
    detectCompetencyFamily('Tell us about a difficult problem you had to solve') === 'problem_solving',
    String(detectCompetencyFamily('Tell us about a difficult problem you had to solve')),
  )
  check('commercial awareness', detectCompetencyFamily('Commercial awareness') === 'commercial')
  check('resilience', detectCompetencyFamily('Dealing with setbacks and pressure') === 'resilience',
    String(detectCompetencyFamily('Dealing with setbacks and pressure')))
  check(
    '"tell us about a time" alone does not vote for planning',
    detectCompetencyFamily('Tell us about a time when') === null,
    String(detectCompetencyFamily('Tell us about a time when')),
  )
  check('unknown text returns null rather than guessing', detectCompetencyFamily('Widget calibration') === null)
  check('empty text returns null', detectCompetencyFamily('') === null)
  check(
    'deterministic across calls',
    detectCompetencyFamily('Teamwork and leadership') === detectCompetencyFamily('Teamwork and leadership'),
  )
  check('every family has a human label', Object.keys(FAMILY_LABELS).length >= 15)
}

console.log('\nmatchAnswersForCompetency: the obvious case')
{
  const matches = matchAnswersForCompetency('Collaboration', BANK, {
    prompt: 'Describe a time you worked with others to deliver something.',
  })
  check('returns something', matches.length > 0, `${matches.length}`)
  check('the teamwork answer ranks first', matches[0]?.answerId === 'a_teamwork', ids(matches))
  check('and is labelled reusable', byId(matches, 'a_teamwork')?.fit === 'reuse',
    String(byId(matches, 'a_teamwork')?.fit))
  check(
    'the reason names the competency, not a score',
    byId(matches, 'a_teamwork')!.reasons.some((r) => r.toLowerCase().includes('teamwork')),
    byId(matches, 'a_teamwork')!.reasons.join(' | '),
  )
  check('every match carries at least one reason', matches.every((m) => m.reasons.length > 0))
  check('commercial awareness is not offered for a teamwork question', !byId(matches, 'a_commercial'), ids(matches))
}

console.log('\nadjacent competencies adapt, they do not match')
{
  const matches = matchAnswersForCompetency('Leadership', BANK, {
    prompt: 'Describe a situation where you took the lead.',
  })
  check('the leadership answer wins', matches[0]?.answerId === 'a_leadership', ids(matches))
  check('leadership is reusable as is', matches[0]?.fit === 'reuse', String(matches[0]?.fit))

  const adjacent = byId(matches, 'a_teamwork')
  check('the teamwork answer is still offered', Boolean(adjacent), ids(matches))
  check('but only as an adaptation', adjacent?.fit === 'adapt', String(adjacent?.fit))
  check(
    'and it scores below the direct match',
    (adjacent?.score ?? 1) < (matches[0]?.score ?? 0),
    `${adjacent?.score} vs ${matches[0]?.score}`,
  )
  check(
    'the adaptation says what the work is',
    adjacent?.caution?.toLowerCase().includes('rework') === true,
    String(adjacent?.caution),
  )
}

console.log('\nhonesty about half-finished answers')
{
  const matches = matchAnswersForCompetency('Resilience', BANK, {
    prompt: 'Tell us about a time you dealt with a setback.',
  })
  const thin = byId(matches, 'a_resilience')
  check('the resilience answer is found', Boolean(thin), ids(matches))
  check('it is not sold as ready to reuse', thin?.fit !== 'reuse', String(thin?.fit))
  check(
    'and the caution names the missing result',
    thin?.caution?.toLowerCase().includes('result') === true,
    String(thin?.caution),
  )
  check(
    'no "measured result" reason on an answer without one',
    !thin?.reasons.some((r) => r.toLowerCase().includes('measured result')),
    thin?.reasons.join(' | '),
  )
}

console.log('\nranking, limits and exclusions')
{
  const all = matchAnswersForCompetency('Teamwork', BANK, { limit: 20 })
  check('scores are sorted descending', all.every((m, i) => i === 0 || all[i - 1].score >= m.score), ids(all))
  check('scores stay within 0 and 1', all.every((m) => m.score > 0 && m.score <= 1),
    all.map((m) => m.score).join(','))

  const limited = matchAnswersForCompetency('Teamwork', BANK, { limit: 2 })
  check('limit is respected', limited.length <= 2, `${limited.length}`)
  check('limit keeps the best', limited[0]?.answerId === all[0]?.answerId)

  const excluded = matchAnswersForCompetency('Teamwork', BANK, {
    limit: 20,
    excludeAnswerId: 'a_teamwork',
  })
  check('the answer being edited is never suggested to itself', !byId(excluded, 'a_teamwork'), ids(excluded))

  check('an empty bank returns nothing', matchAnswersForCompetency('Teamwork', []).length === 0)
  check(
    'an unrecognisable competency does not fabricate matches',
    matchAnswersForCompetency('Widget calibration', BANK).length === 0,
    ids(matchAnswersForCompetency('Widget calibration', BANK)),
  )
  check('an empty competency returns nothing', matchAnswersForCompetency('', BANK).length === 0)
}

console.log('\ndeterminism and purity')
{
  const a = matchAnswersForCompetency('Teamwork', BANK, { limit: 20 })
  const b = matchAnswersForCompetency('Teamwork', BANK, { limit: 20 })
  check('same input, same output', JSON.stringify(a) === JSON.stringify(b))

  const snapshot = JSON.stringify(BANK)
  matchAnswersForCompetency('Teamwork', BANK, { limit: 20 })
  check('does not mutate its input', JSON.stringify(BANK) === snapshot)

  const shuffled = [commercial, resilience, teamwork, problemSolving, leadership]
  const fromShuffled = matchAnswersForCompetency('Teamwork', shuffled, { limit: 20 })
  check(
    'ranking does not depend on input order',
    ids(fromShuffled) === ids(a),
    `${ids(fromShuffled)} vs ${ids(a)}`,
  )

  // Ties break on recency, so the more recently edited of two identical
  // answers is the one offered first.
  const older: ReuseCandidate = { ...teamwork, _id: 'a_old', updatedAt: now - 400 * DAY }
  const newer: ReuseCandidate = { ...teamwork, _id: 'a_new', updatedAt: now }
  const tie = matchAnswersForCompetency('Teamwork', [older, newer], { limit: 5 })
  check('a tie breaks towards the newer answer', tie[0]?.answerId === 'a_new', ids(tie))
  check('scores really were tied', tie[0]?.score === tie[1]?.score, `${tie[0]?.score} vs ${tie[1]?.score}`)
}

console.log('\nthe compounding case: a bank of one, then a bank of five')
{
  // The product claim is that the bank gets more useful as it fills. It has to
  // be true of the code, not just the pitch: a broader bank must cover more of
  // the competencies an employer can ask about.
  const questions = [
    'Teamwork',
    'Leadership',
    'Problem solving',
    'Resilience',
    'Commercial awareness',
    'Working with others to hit a deadline',
  ]
  const covered = (bank: ReuseCandidate[]) =>
    questions.filter((q) => matchAnswersForCompetency(q, bank).length > 0).length
  const one = covered([teamwork])
  const five = covered(BANK)
  check('one banked answer covers some questions', one > 0, `${one}/${questions.length}`)
  check('five cover strictly more', five > one, `${five} vs ${one}`)
  check('five cover most of them', five >= 5, `${five}/${questions.length}`)
}

// ---------------------------------------------------------------------------
// The prompt output contract. These parsers are what turn Charge's prose into
// the `strengths` / `fixes` / `actions` arrays stored in the schema, so a drift
// here silently empties a student's checklist.
// ---------------------------------------------------------------------------

console.log('\nparsing a critique')
{
  const reply = [
    "## What's working",
    '- The situation is set up fast - "six of us, two days, no phone signal".',
    '- **You name the constraint** rather than describing the weather.',
    '',
    '## What\'s missing',
    '- There is no Result. The answer stops when the walk finishes.',
    '- You write "we planned" where you mean "I planned".',
    '',
    '## Fix these first',
    '1. Add one sentence at the end saying what changed because of you.',
    '2. Put a number on it - minutes ahead, or the assessor\'s words.',
    '3. Change three "we" sentences to "I".',
    '',
    '## Questions only you can answer',
    'What did the assessor actually say?',
    '',
    '## One sentence, reworked',
    '> We got there in the end.',
    'I brought the group in 40 minutes ahead of the planned finish.',
  ].join('\n')

  const parsed = parseCritique(reply)
  check('strengths lifted', parsed.strengths.length === 2, JSON.stringify(parsed.strengths))
  check('markdown emphasis stripped', parsed.strengths[1]?.startsWith('You name the constraint'),
    parsed.strengths[1])
  check('fixes lifted in order', parsed.fixes.length === 3, JSON.stringify(parsed.fixes))
  check('first fix is the result', parsed.fixes[0].includes('what changed'), parsed.fixes[0])
  check('the missing section is not scraped into strengths',
    !parsed.strengths.some((s) => s.includes('no Result')))
  check('the prose body is kept whole', parsed.body === reply)
  check('a reply that ignores the skeleton yields empty arrays, not a throw',
    parseCritique('Nice work, keep going.').fixes.length === 0)
  check('empty input is safe', parseCritique('').strengths.length === 0)
}

console.log('\nparsing a rejection debrief')
{
  const reply = [
    '## What this actually tells you',
    'That one stings, and it is meant to. You were cut at the online test.',
    '',
    '## Do these two things',
    '1. Do three timed numerical practice sets this week,',
    '   under the same time limit as the real thing.',
    '2. Bank the teamwork answer you wrote for this application while it is fresh.',
    '',
    '## Then',
    'The next deadline worth your attention is in three weeks.',
  ].join('\n')

  const parsed = parseDebrief(reply)
  check('two actions lifted', parsed.actions.length === 2, JSON.stringify(parsed.actions))
  check('a wrapped action stays one action', parsed.actions[0].includes('under the same time limit'),
    parsed.actions[0])
  check('the "Then" section is not swallowed into the actions',
    !parsed.actions.some((a) => a.includes('three weeks')))
  check('no numbered list yields no actions', parseDebrief('## Do these two things\nTry harder.').actions.length === 0)
}

console.log('\nparsing a competitiveness verdict')
{
  const stretch = parseCompetitiveness(
    '## Straight answer\n**Stretch** - your predicted grades are one below their stated minimum.\n\n## What counts in your favour\n- Real work experience.',
  )
  check('verdict read from the heading', stretch.verdict === 'stretch', stretch.verdict)
  check('body preserved', stretch.body.includes('predicted grades'))

  check('long shot', parseCompetitiveness('## Straight answer\nLong shot, and here is why.').verdict === 'long shot')
  check('strong fit', parseCompetitiveness('## Straight answer\nStrong fit. You clear the bar.').verdict === 'strong fit')
  check('realistic', parseCompetitiveness('## Straight answer\nRealistic, on what you have told me.').verdict === 'realistic')
  check(
    'an off-script reply is unclear rather than mislabelled',
    parseCompetitiveness('I would need your grades before I can say.').verdict === 'unclear',
  )
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
