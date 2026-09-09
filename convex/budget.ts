/**
 * Shared metering for everything that costs money to serve.
 *
 * The governing rule: a user can never cost more than they pay. That is
 * enforced by checking budget BEFORE the spend happens, never by reconciling
 * afterwards. Reconciliation is how you discover you lost money.
 *
 * Voice is metered in minutes rather than tokens, for three reasons:
 *   - a user understands "42 minutes left", not "1.2M audio tokens left"
 *   - a session can be hard-stopped mid-call on a minute boundary
 *   - one configurable rate converts minutes to cost when prices change
 *
 * Voice and text draw from the SAME monthly cost envelope, so a user cannot
 * exceed the ceiling by switching between them.
 */
import type { Tier } from './tiers'
import { TIERS } from './tiers'

/**
 * USD per minute of live audio.
 *
 * Verified against Google's published pricing for gemini-3.1-flash-live-preview
 * on 2026-09-03: audio input $0.005/min, audio output $0.018/min. The default
 * below is the sum, which is the worst case where both directions stream for
 * the whole minute. Real conversations are cheaper, because the model is not
 * speaking while the user is.
 *
 * If the model changes, re-check the rate and re-run
 * `python3 tools/cost/model.py --voice-rate-per-min <rate> --heavy-user`.
 */
export const VOICE_USD_PER_MINUTE = Number(process.env.VOICE_USD_PER_MINUTE ?? 0.023)

export interface VoicePolicy {
  /** Minutes granted per calendar month. */
  monthlyMinutes: number
  /** Hard ceiling on any single call, enforced by credential TTL. */
  maxSessionMinutes: number
}

/**
 * Per-tier voice allowances.
 *
 * Flash gets a genuine but small trial: the feature has to be experienced to be
 * worth paying for, and a 10-minute mock interview is enough to feel the value.
 * Pro's 60 minutes is roughly four 15-minute mock interviews a month, which is
 * more interview practice than most applicants get in an entire cycle.
 */
export const VOICE_POLICY: Record<Tier, VoicePolicy> = {
  flash: { monthlyMinutes: Number(process.env.VOICE_MINUTES_FLASH ?? 10), maxSessionMinutes: 10 },
  pro: { monthlyMinutes: Number(process.env.VOICE_MINUTES_PRO ?? 60), maxSessionMinutes: 15 },
}

/** Cost of a number of voice seconds, in micro-dollars. */
export function voiceCostMicros(seconds: number): number {
  return Math.round((seconds / 60) * VOICE_USD_PER_MINUTE * 1_000_000)
}

export interface UsageSnapshot {
  costMicros: number
  voiceSeconds: number
}

export interface BudgetVerdict {
  ok: boolean
  /** Whole minutes the user may still spend on voice this month. */
  remainingMinutes: number
  /** Minutes this session may run for: the lesser of remaining and the cap. */
  sessionMinutes: number
  reason?: string
}

/**
 * Decide whether a voice session may start, and how long it may run.
 *
 * Deliberately pure so the arithmetic can be unit tested without a database.
 * Every caller must treat `ok: false` as final - there is no override path,
 * because an override path is how cost controls stop working.
 */
export function checkVoiceBudget(
  tier: Tier,
  usage: UsageSnapshot,
  activeSessions: number,
): BudgetVerdict {
  const policy = VOICE_POLICY[tier]
  const tierConfig = TIERS[tier]

  // One live session per user. Prevents double-billing from a stale tab and
  // the most obvious form of abuse.
  if (activeSessions > 0) {
    return {
      ok: false,
      remainingMinutes: 0,
      sessionMinutes: 0,
      reason: 'You already have a call in progress. End it before starting another.',
    }
  }

  // The shared monthly envelope. If text has eaten it, voice stops too.
  if (usage.costMicros >= tierConfig.monthlyCostMicros) {
    return {
      ok: false,
      remainingMinutes: 0,
      sessionMinutes: 0,
      reason:
        tier === 'pro'
          ? "You've used this month's Pro allowance. It resets on the 1st."
          : "LIMIT:You've used this month's free allowance. Upgrade to Pro for more.",
    }
  }

  const usedMinutes = usage.voiceSeconds / 60
  const remainingMinutes = Math.floor(policy.monthlyMinutes - usedMinutes)

  if (remainingMinutes < 1) {
    return {
      ok: false,
      remainingMinutes: 0,
      sessionMinutes: 0,
      reason:
        tier === 'pro'
          ? `You've used all ${policy.monthlyMinutes} voice minutes this month. They reset on the 1st.`
          : `LIMIT:You've used your ${policy.monthlyMinutes} free voice minutes. Upgrade to Pro for ${VOICE_POLICY.pro.monthlyMinutes} a month.`,
    }
  }

  // Also respect what is left in the cost envelope, so a rate rise cannot
  // silently turn a within-minutes session into an over-budget one.
  const envelopeLeftMicros = tierConfig.monthlyCostMicros - usage.costMicros
  const envelopeMinutes = Math.floor(envelopeLeftMicros / voiceCostMicros(60))

  const sessionMinutes = Math.max(
    1,
    Math.min(policy.maxSessionMinutes, remainingMinutes, envelopeMinutes || 1),
  )

  return { ok: true, remainingMinutes, sessionMinutes }
}
