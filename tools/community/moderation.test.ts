/**
 * Tests for screenPost in convex/moderation.ts.
 *
 *   node --experimental-strip-types tools/community/moderation.test.ts
 *
 * The false-positive cases matter as much as the catches. A filter that flags
 * every post mentioning a salary or an intake year trains the human reviewer
 * to click "approve" without reading, which is worse than having no filter.
 *
 * The resolve hook below exists because convex/moderation.ts imports
 * './_generated/server' extensionlessly, which Node's ESM resolver will not
 * find. screenPost itself is pure and imports nothing.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

// Convex source imports siblings without a file extension ('./users',
// './_generated/server'), which Node's ESM resolver rejects. Add the extension
// back on the way through: '.ts' where a TypeScript sibling exists, otherwise
// '.js' for the generated JavaScript.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
      const base = dirname(fileURLToPath(context.parentURL))
      const candidate = resolvePath(base, specifier)
      const ext = existsSync(candidate + '.ts') ? '.ts' : existsSync(candidate + '.js') ? '.js' : ''
      if (ext) return nextResolve(specifier + ext, context)
    }
    return nextResolve(specifier, context)
  },
})

const { screenPost, MAX_POST_CHARS, LONG_POST_CHARS } = await import('../../convex/moderation.ts')

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

/** Asserts the verdict, and that the expected reason slug is among the reasons. */
function expect(body: string, verdict: string, reason?: string, label = body.slice(0, 48)) {
  const r = screenPost(body)
  const ok = r.verdict === verdict && (!reason || r.reasons.includes(reason))
  check(label, ok, `got ${r.verdict} [${r.reasons.join(', ')}]`)
}

console.log('\nphone numbers')
{
  for (const n of [
    'call me on 07123 456789',
    'my number is 07123456789',
    'ring +44 7123 456789',
    'text 07123-456-789',
    'landline is 0161 496 0000',
    '(07123) 456 789 if you want',
  ]) {
    expect(n, 'review', 'phone-number')
  }
}

console.log('\nemail addresses')
{
  expect('email me jo.smith@gmail.com', 'review', 'email-address')
  expect('joe at gmail dot com', 'review', 'email-address')
  expect('joe(at)outlook(dot)com', 'review', 'email-address')
  expect('reach me on j_bloggs99@hotmail.co.uk', 'review', 'email-address')
}

console.log('\nmoving to private messaging')
{
  expect('dm me on insta', 'review', 'private-messaging-invite')
  expect('add me on discord and we can chat there', 'review', 'private-messaging-invite')
  expect('my snap is joebloggs', 'review', 'private-messaging-invite')
  expect('hit me up if you want the answers', 'review', 'private-messaging-invite')
  expect('pm me and I will send it over', 'review', 'private-messaging-invite')
  expect("let's talk privately about this", 'review', 'private-messaging-invite')
  expect('there is a group chat for this intake', 'review', 'private-messaging-invite')
  expect('@joebloggs is in the same cohort', 'review', 'social-handle')
  expect('anyone else seen the tiktok about this scheme', 'review', 'contact-platform-mention')
}

console.log('\nexternal links')
{
  expect('apply here https://example.com/jobs/123', 'review', 'external-link')
  expect('see www.example.co.uk for the dates', 'review', 'external-link')
  expect('the details are on gov.uk', 'review', 'external-link')
  expect('go to example dot com', 'review', 'external-link')
}

console.log('\nlanguage')
{
  expect('this process is absolutely fucking exhausting', 'review', 'profanity')
  expect('you are a retard', 'block', 'severe-language')
  expect('send nudes', 'block', 'sexual-content')
}

console.log('\nsafeguarding overrides everything')
{
  const r = screenPost('after that rejection I honestly want to die')
  check('distress routes to review', r.verdict === 'review', r.verdict)
  check('distress is flagged', r.reasons.includes('possible-safeguarding-concern'), r.reasons.join(','))
  check('distress is first in the reasons', r.reasons[0] === 'possible-safeguarding-concern', r.reasons.join(','))

  // The important one: a distressed post is never bounced back automatically,
  // even when it also contains something that would otherwise be refused.
  const mixed = screenPost('this fucking place, I want to die honestly')
  check('distress plus profanity still reaches a human', mixed.verdict === 'review', mixed.verdict)
  const worst = screenPost('kill myself, what a cunt of a process')
  check('distress outranks a block-level reason', worst.verdict === 'review', `${worst.verdict} [${worst.reasons.join(',')}]`)
}

console.log('\nlength')
{
  expect('a'.repeat(MAX_POST_CHARS + 1), 'block', 'over-length', `over ${MAX_POST_CHARS} chars is blocked`)
  expect('a'.repeat(LONG_POST_CHARS + 1), 'review', 'unusually-long', `over ${LONG_POST_CHARS} chars is reviewed`)
  expect('a'.repeat(LONG_POST_CHARS - 1), 'allow', undefined, `under ${LONG_POST_CHARS} chars is clean`)
}

console.log('\nclean posts must actually come back clean')
{
  for (const post of [
    'Has anyone heard back from the Level 6 scheme yet? I submitted three weeks ago.',
    'I have my assessment centre on Tuesday. Any tips for the group exercise?',
    'Got a 7 in maths and a 6 in English, is that enough for a degree apprenticeship?',
    'Applications open in September 2026 and close in November 2026.',
    'The online test was 45 minutes, mostly numerical reasoning.',
    'Starting salary is £22,000, going up to £28,000 in year two.',
    'I finally got an offer after 11 rejections. Keep going, it is worth it.',
    'The interview is at 5 pm on Thursday, does anyone know how long it runs?',
    'They asked me a teamwork question and a time I solved a problem.',
    'My school is not helping much so this is all self taught honestly.',
  ]) {
    expect(post, 'allow')
  }
}

console.log('\nverdict shape')
{
  const clean = screenPost('  ')
  check('empty post is allow with no reasons', clean.verdict === 'allow' && clean.reasons.length === 0)
  const many = screenPost('dm me on insta, 07123 456789, jo@gmail.com, www.example.com')
  check('reasons are unique', new Set(many.reasons).size === many.reasons.length, many.reasons.join(','))
  check('multiple signals collected', many.reasons.length >= 4, many.reasons.join(','))
  check('pure: same input, same output', JSON.stringify(screenPost('dm me')) === JSON.stringify(screenPost('dm me')))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
