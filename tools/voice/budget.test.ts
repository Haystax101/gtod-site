/**
 * Tests for convex/budget.ts.
 *
 * This is the code that stops a user costing more than they pay, so it is
 * tested harder than anything else in the build. Every case below is a way we
 * could lose money if the arithmetic were wrong.
 *
 *   node --experimental-strip-types tools/voice/budget.test.ts
 */
import { checkVoiceBudget, voiceCostMicros, VOICE_POLICY } from '../../convex/budget.ts'
import { TIERS } from '../../convex/tiers.ts'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`) }
}
const fresh = { costMicros: 0, voiceSeconds: 0 }

console.log('\ncost conversion')
{
  const perMin = voiceCostMicros(60)
  check('a minute costs something', perMin > 0, String(perMin))
  check('ten minutes costs ten times one', voiceCostMicros(600) === perMin * 10)
  check('zero seconds is free', voiceCostMicros(0) === 0)
}

console.log('\nhappy path')
{
  const pro = checkVoiceBudget('pro', fresh, 0)
  check('pro may start', pro.ok)
  check('pro session capped at policy', pro.sessionMinutes === VOICE_POLICY.pro.maxSessionMinutes,
    String(pro.sessionMinutes))
  check('pro sees full monthly allowance',
    pro.remainingMinutes === VOICE_POLICY.pro.monthlyMinutes, String(pro.remainingMinutes))

  const flash = checkVoiceBudget('flash', fresh, 0)
  check('flash may start (trial)', flash.ok)
  check('flash gets less than pro',
    VOICE_POLICY.flash.monthlyMinutes < VOICE_POLICY.pro.monthlyMinutes)
}

console.log('\nconcurrency')
{
  const r = checkVoiceBudget('pro', fresh, 1)
  check('a second concurrent session is refused', !r.ok)
  check('refusal explains why', /call in progress/i.test(r.reason ?? ''), r.reason)
  check('refused session grants no minutes', r.sessionMinutes === 0)
}

console.log('\nminute budget')
{
  const spent = { costMicros: 0, voiceSeconds: VOICE_POLICY.pro.monthlyMinutes * 60 }
  const r = checkVoiceBudget('pro', spent, 0)
  check('exhausted minutes refuses', !r.ok)
  check('exhausted grants no minutes', r.sessionMinutes === 0)

  // 5 minutes left, cap is 15: the session must be the smaller number.
  const nearly = {
    costMicros: 0,
    voiceSeconds: (VOICE_POLICY.pro.monthlyMinutes - 5) * 60,
  }
  const near = checkVoiceBudget('pro', nearly, 0)
  check('partial allowance still starts', near.ok)
  check('session shrinks to what is left', near.sessionMinutes === 5, String(near.sessionMinutes))
  check('never exceeds the per-session cap',
    near.sessionMinutes <= VOICE_POLICY.pro.maxSessionMinutes)
}

console.log('\nshared cost envelope')
{
  const blown = { costMicros: TIERS.pro.monthlyCostMicros, voiceSeconds: 0 }
  const r = checkVoiceBudget('pro', blown, 0)
  check('text spend can close voice', !r.ok, r.reason)

  // Envelope nearly gone but minutes untouched: cost must still constrain.
  const tight = {
    costMicros: TIERS.pro.monthlyCostMicros - voiceCostMicros(60) * 2,
    voiceSeconds: 0,
  }
  const t = checkVoiceBudget('pro', tight, 0)
  check('a nearly-spent envelope shortens the session',
    !t.ok || t.sessionMinutes <= 2, `${t.ok} / ${t.sessionMinutes}`)

  const flashBlown = { costMicros: TIERS.flash.monthlyCostMicros, voiceSeconds: 0 }
  const f = checkVoiceBudget('flash', flashBlown, 0)
  check('free tier refusal is upgrade-flagged', (f.reason ?? '').startsWith('LIMIT:'), f.reason)
}

console.log('\ninvariants across the whole input space')
{
  let violations = 0
  for (const tier of ['flash', 'pro'] as const) {
    for (let mins = 0; mins <= VOICE_POLICY[tier].monthlyMinutes + 5; mins++) {
      for (const micros of [0, TIERS[tier].monthlyCostMicros / 2, TIERS[tier].monthlyCostMicros]) {
        const r = checkVoiceBudget(tier, { costMicros: micros, voiceSeconds: mins * 60 }, 0)
        if (r.sessionMinutes > VOICE_POLICY[tier].maxSessionMinutes) violations++
        if (r.ok && r.sessionMinutes < 1) violations++
        if (!r.ok && r.sessionMinutes !== 0) violations++
      }
    }
  }
  check('no input ever grants more than the cap, or an approved zero-length session',
    violations === 0, `${violations} violations`)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
