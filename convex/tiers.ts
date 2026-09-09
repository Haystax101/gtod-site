// Everything about what each plan gets and what it costs us, in one place.
//
// Both tiers are served through OpenRouter, so the model is a slug rather than a
// provider choice. The slugs below are defaults only - confirm them against
// OpenRouter's model list and override with OPENROUTER_MODEL_FLASH /
// OPENROUTER_MODEL_PRO rather than editing this file.
// Prices are USD per million tokens (input / output); costs are tracked in micro-dollars.

export type Tier = 'flash' | 'pro'

export interface TierConfig {
  label: string
  /** OpenRouter model slug. Set via env so a model swap needs no deploy. */
  model: string
  dailyMessages: number
  monthlyCostMicros: number
  maxOutputTokens: number
  inputPerM: number
  outputPerM: number
  contextMessages: number
}

export const TIERS: Record<Tier, TierConfig> = {
  flash: {
    label: 'Flash',
    model: process.env.OPENROUTER_MODEL_FLASH ?? 'deepseek/deepseek-chat',
    dailyMessages: 25,
    monthlyCostMicros: 600_000, // $0.60, a safety net only
    // The Flash model spends tokens on internal reasoning before it answers,
    // and those count against this cap, so a 700 budget was cutting real
    // replies off mid-word. Headroom here costs nothing when unused: billing
    // follows actual usage, and the monthly envelope is the real guard.
    maxOutputTokens: 1600,
    inputPerM: 0.44, // peak-rate cache miss, worst case
    outputPerM: 1.32,
    contextMessages: 12,
  },
  pro: {
    label: 'Pro',
    model: process.env.OPENROUTER_MODEL_PRO ?? 'x-ai/grok-4',
    dailyMessages: 150,
    monthlyCostMicros: 8_000_000, // $8 ≈ £6, the cost ceiling behind the £10 plan
    maxOutputTokens: 2600,
    inputPerM: 2,
    outputPerM: 6,
    contextMessages: 24,
  },
}

export function costMicros(tier: Tier, inputTokens: number, outputTokens: number) {
  const t = TIERS[tier]
  return Math.round(inputTokens * t.inputPerM + outputTokens * t.outputPerM)
}

export function monthKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 7)
}

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

// Rough token estimate used when a provider omits usage in its stream.
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

/**
 * Accounts that may exercise paid features without being billed against a
 * monthly allowance, so the team can test the product end to end.
 *
 * Set on the deployment, never in the repo - this repository is public and
 * these are personal email addresses:
 *
 *   npx convex env set TEST_PRO_EMAILS "someone@example.com,other@example.com"
 *
 * Read where the code runs, so adding an address takes effect on the next call
 * with no deploy. Empty by default, which is what production should stay.
 */
export function isTestProAccount(email?: string | null): boolean {
  if (!email) return false
  // String() so the list is typed even where node's process types are absent.
  const raw = String(process.env.TEST_PRO_EMAILS ?? '')
  if (!raw.trim()) return false
  const wanted = email.trim().toLowerCase()
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(wanted)
}
