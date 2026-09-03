// Everything about what each plan gets and what it costs us, in one place.
//
// Both tiers are served through OpenRouter, so the model is a slug rather than a
// provider choice. The slugs below are the ones verified working on 2026-09-03;
// override them with OPENROUTER_MODEL_FLASH / OPENROUTER_MODEL_PRO rather than
// editing this file. An invalid slug fails the whole request with a 400.
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
    model: process.env.OPENROUTER_MODEL_FLASH ?? 'deepseek/deepseek-v4-flash-0731',
    dailyMessages: 25,
    monthlyCostMicros: 600_000, // $0.60, a safety net only
    maxOutputTokens: 700,
    inputPerM: 0.44, // peak-rate cache miss, worst case
    outputPerM: 1.32,
    contextMessages: 12,
  },
  pro: {
    label: 'Pro',
    model: process.env.OPENROUTER_MODEL_PRO ?? 'x-ai/grok-4.6',
    dailyMessages: 150,
    monthlyCostMicros: 8_000_000, // $8 ≈ £6, the cost ceiling behind the £10 plan
    maxOutputTokens: 1400,
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
