/**
 * Charge as coach: the answer bank, competency critique, the competitiveness
 * read, and the rejection debrief.
 *
 * Two things about this file are worth reading before changing it.
 *
 * 1. **Charge coaches, it never ghost-writes.** The prompts in coachPrompts.ts
 *    carry that rule; everything here exists to put the right material in front
 *    of them. Nothing in this file should ever produce, store or return a
 *    finished answer written on the student's behalf.
 *
 * 2. **Every model call is metered before it happens.** A coaching action costs
 *    the same money as a chat message and is capped the same way: the daily
 *    envelope is shared with chat, and the monthly cost ceiling is charged
 *    up front at the worst case and reconciled down afterwards. See
 *    `beginRun` / `settleRun`. Reconciling afterwards only is how you lose
 *    money on a user; see docs/BUILD_PLAN.md rule 1.
 *
 * The pure functions at the top (`starSignals`, `detectCompetencyFamily`,
 * `matchAnswersForCompetency`) have no Convex imports in their path and are
 * unit tested by tools/coach/reuse.test.ts.
 */
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { tier as tierValidator } from './schema'
import { currentUser, requireUser } from './users'
import { TIERS, costMicros, estimateTokens, monthKey, startOfDay, type Tier } from './tiers'
import { buildUserTurn } from './prompt'
import { bm25, fuse, selectChunks, tokenize } from './retrieval'
import { embed, embeddingConfig } from './embeddings'
import {
  COACH_PROMPTS,
  parseCompetitiveness,
  parseCritique,
  parseDebrief,
  type CoachMode,
  type Verdict,
} from './coachPrompts'

// ============================================================================
// Pure logic: STAR signals and answer reuse
// ============================================================================
//
// This half of the file is deliberately free of Convex, network and clock
// dependencies so it can be tested directly with
// `node --experimental-strip-types tools/coach/reuse.test.ts`.

/** Longest answer we will store or send. Roughly three sides of A4. */
export const MAX_ANSWER_CHARS = 6000
/** Longest employer question we will store. */
export const MAX_PROMPT_CHARS = 600
/** Longest competency label. Free text, because employers name these anything. */
export const MAX_COMPETENCY_CHARS = 120

// ---------------------------------------------------------------- STAR signals

export interface StarSignals {
  hasResult: boolean
  hasNumbers: boolean
  /** Share of first-person singular markers among all person markers, 0-1. */
  ownership: number
  words: number
  complete: boolean
}

/**
 * Phrases that mark the Result of a STAR answer.
 *
 * Deliberately phrase-based rather than keyword-based: "result" as a bare word
 * appears constantly in these answers ("as a team we got the result we wanted")
 * without any outcome actually being stated. What distinguishes a real Result
 * is a consequence construction - something changed *because* of the action.
 */
const RESULT_MARKERS = [
  /\bas a result\b/,
  /\bresult(?:ed|ing) in\b/,
  /\bresult:\s/,
  /\bmeant (?:that|we|i|it|they|the|a|an)\b/,
  /\bwhich (?:meant|led|helped|allowed|saved|raised|increased|reduced|cut|improved)\b/,
  /\b(?:led|leading) to\b/,
  /\bthe outcome\b/,
  /\b(?:in|by) the end\b/,
  /\bwent (?:from\b.{0,40}\bto|up|down)\b/,
  // Outcome verbs in the first or second person. "got" is deliberately absent:
  // "we got the result we wanted" states no outcome at all, and it is one of
  // the most common ways an answer pretends to have one.
  /\b(?:we|i) (?:went on to|ended up|finished|came|won|raised|increased|reduced|cut|saved|beat|improved|delivered|scored|hit|reached|completed)\b/,
  /\bahead of (?:schedule|plan|target|time|our|the)\b/,
  // Feedback from a named person is a legitimate Result when no number exists.
  /\bfeedback (?:was|from|said)\b/,
  /\bthe (?:assessor|manager|teacher|client|customer|employer|owner|supervisor|examiner) (?:said|told|picked|noted|fed back)\b/,
]

/** A number, a percentage, a money amount or a time span. */
const NUMBER_MARKER = /(\d|\bper cent\b|\bpercent\b|£|%)/

/**
 * Cheap structural read of an answer.
 *
 * Used for two things: setting `answers.starComplete` on save so the bank can
 * show at a glance which answers are ready to reuse, and scoring reuse
 * candidates. It is a heuristic and is documented to the user as one - the real
 * judgement is `critiqueAnswer`, which costs a model call. This costs nothing,
 * so it can run on every keystroke-save without touching the budget.
 *
 * `ownership` exists because "we" instead of "I" is the most expensive habit in
 * this format: an assessor scores one candidate and cannot score a team. A low
 * ownership score is the single most useful thing we can flag for free.
 */
export function starSignals(body: string): StarSignals {
  const text = body.toLowerCase()
  const words = (body.trim().match(/\S+/g) ?? []).length
  const hasResult = RESULT_MARKERS.some((re) => re.test(text))
  const hasNumbers = NUMBER_MARKER.test(text)
  const singular = (text.match(/\b(?:i|me|my|mine)\b/g) ?? []).length
  const plural = (text.match(/\b(?:we|us|our|ours)\b/g) ?? []).length
  const total = singular + plural
  const ownership = total === 0 ? 0 : singular / total
  return {
    hasResult,
    hasNumbers,
    ownership,
    words,
    // All four have to hold. An answer with a measured result told in the first
    // person, at a length an employer's box will actually take, is reusable.
    complete: hasResult && hasNumbers && ownership >= 0.5 && words >= 80,
  }
}

// ---------------------------------------------------------------- competency families

/**
 * The competency families employers actually assess against, and the words
 * they use for them.
 *
 * Employers name the same handful of things a dozen different ways -
 * "collaboration", "working with others", "teamwork", "one team" are one
 * competency with four labels. Matching on the label alone would mean a
 * student's teamwork answer is invisible when the next employer calls it
 * "collaborating to deliver". Mapping to a family first is what makes the
 * answer bank compound instead of being a folder of unrelated text.
 *
 * Keywords are matched after `tokenize` from retrieval.ts, so both sides get
 * the same stopword removal and plural normalisation for free.
 */
const FAMILY_KEYWORDS: Record<string, string[]> = {
  teamwork: ['teamwork', 'team', 'collaborate', 'collaboration', 'collaborating', 'others', 'group', 'peers', 'together', 'inclusive'],
  leadership: ['leadership', 'leading', 'lead', 'led', 'captain', 'delegate', 'delegating', 'mentor', 'mentoring', 'supervise', 'responsibility', 'motivate', 'motivating'],
  communication: ['communication', 'communicate', 'communicating', 'explain', 'explaining', 'presentation', 'presenting', 'influence', 'influencing', 'persuade', 'listening', 'stakeholder'],
  problem_solving: ['problem', 'solving', 'solve', 'analytical', 'analysis', 'analyse', 'troubleshoot', 'diagnose', 'logical', 'reasoning', 'decision', 'judgement'],
  resilience: ['resilience', 'resilient', 'setback', 'pressure', 'difficult', 'failure', 'failed', 'perseverance', 'persevered', 'overcome', 'overcame', 'stress'],
  adaptability: ['adaptability', 'adaptable', 'adapt', 'flexibility', 'flexible', 'change', 'changing', 'ambiguity', 'uncertainty', 'unexpected'],
  initiative: ['initiative', 'proactive', 'self', 'starter', 'drive', 'motivation', 'motivated', 'ownership', 'volunteered', 'spotted'],
  // "time" is deliberately absent: nearly every competency question opens
  // "tell us about a time when...", so it would vote for planning constantly.
  planning: ['planning', 'plan', 'organisation', 'organising', 'organised', 'prioritise', 'prioritising', 'deadline', 'deadlines', 'management', 'juggling', 'workload', 'schedule'],
  detail: ['detail', 'accuracy', 'accurate', 'thorough', 'checking', 'quality', 'meticulous', 'error', 'errors', 'precise'],
  customer: ['customer', 'customers', 'client', 'clients', 'service', 'user', 'users', 'members', 'public'],
  commercial: ['commercial', 'awareness', 'business', 'industry', 'sector', 'market', 'competitor', 'profit', 'cost', 'why'],
  learning: ['learning', 'learn', 'curiosity', 'curious', 'development', 'developing', 'training', 'taught', 'studied', 'upskilled'],
  innovation: ['innovation', 'innovative', 'creative', 'creativity', 'idea', 'ideas', 'improvement', 'improving', 'improve', 'better', 'efficiency'],
  integrity: ['integrity', 'ethics', 'ethical', 'honest', 'honesty', 'fairness', 'diversity', 'inclusion', 'right'],
  digital: ['digital', 'technology', 'technical', 'coding', 'code', 'software', 'data', 'spreadsheet', 'automation', 'system'],
}

/** Human labels for the families, used in the reasons we show the student. */
export const FAMILY_LABELS: Record<string, string> = {
  teamwork: 'teamwork',
  leadership: 'leadership',
  communication: 'communication',
  problem_solving: 'problem solving',
  resilience: 'resilience',
  adaptability: 'adaptability',
  initiative: 'initiative',
  planning: 'planning and organisation',
  detail: 'attention to detail',
  customer: 'customer focus',
  commercial: 'commercial awareness',
  learning: 'learning and curiosity',
  innovation: 'innovation and improvement',
  integrity: 'integrity and inclusion',
  digital: 'digital and technical',
}

/**
 * Families that adapt into one another with real but partial credit.
 *
 * A teamwork story usually contains a leadership beat and vice versa; a
 * resilience story is nearly always an adaptability story told from the other
 * end. Telling a student "this is adaptable" rather than "this is a match"
 * matters: it sets the expectation that they will have to rework the Action
 * and Result to point at the new competency, which is the actual work.
 */
const ADJACENT: [string, string][] = [
  ['teamwork', 'leadership'],
  ['teamwork', 'communication'],
  ['leadership', 'initiative'],
  ['leadership', 'planning'],
  ['communication', 'customer'],
  ['communication', 'leadership'],
  ['problem_solving', 'detail'],
  ['problem_solving', 'innovation'],
  ['problem_solving', 'digital'],
  ['resilience', 'adaptability'],
  ['resilience', 'planning'],
  ['adaptability', 'learning'],
  ['initiative', 'innovation'],
  ['planning', 'detail'],
  ['customer', 'commercial'],
  ['learning', 'digital'],
  ['integrity', 'teamwork'],
]

function isAdjacent(a: string, b: string): boolean {
  return ADJACENT.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

/** Keyword lookup, built once: normalised term -> family. */
const TERM_TO_FAMILY: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [family, words] of Object.entries(FAMILY_KEYWORDS)) {
    for (const word of words) {
      for (const term of tokenize(word)) {
        // First family to claim a term keeps it, so the order of
        // FAMILY_KEYWORDS is the tie-break. Overlaps are few and deliberate.
        if (!map.has(term)) map.set(term, family)
      }
    }
  }
  return map
})()

/**
 * Best-guess competency family for a free-text label or question.
 *
 * Returns null rather than a wrong guess: an unknown family degrades the match
 * to pure lexical overlap, which is honest, where a wrong family would confidently
 * recommend a teamwork answer for a commercial awareness question.
 */
export function detectCompetencyFamily(text: string): string | null {
  const counts = new Map<string, number>()
  for (const term of tokenize(text)) {
    const family = TERM_TO_FAMILY.get(term)
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1)
  }
  if (!counts.size) return null
  let best: string | null = null
  let bestCount = 0
  // Ties break on the declaration order of FAMILY_KEYWORDS, which keeps the
  // function deterministic - important, because it is user-visible.
  for (const family of Object.keys(FAMILY_KEYWORDS)) {
    const count = counts.get(family) ?? 0
    if (count > bestCount) {
      best = family
      bestCount = count
    }
  }
  return best
}

// ---------------------------------------------------------------- reuse matching

/** The shape `matchAnswersForCompetency` needs. A Doc<'answers'> satisfies it. */
export interface ReuseCandidate {
  _id: string
  competency: string
  prompt: string
  body: string
  starComplete?: boolean
  updatedAt: number
}

export type ReuseFit = 'reuse' | 'adapt' | 'stretch'

export interface ReuseMatch {
  answerId: string
  /** 0-1. Comparable between candidates for one target, not across targets. */
  score: number
  fit: ReuseFit
  /** Why it matched, in words we can show the student verbatim. */
  reasons: string[]
  /** What they will have to fix before it is reusable, if anything. */
  caution?: string
}

export interface ReuseOptions {
  /** The employer's question, if we have it. Sharpens the lexical half. */
  prompt?: string
  limit?: number
  /** Never suggest the answer they are currently looking at. */
  excludeAnswerId?: string
  /** Below this, we say nothing rather than pad the list. */
  minScore?: number
}

const FAMILY_WEIGHT = 0.6
const LEXICAL_WEIGHT = 0.4
const STAR_BONUS = 0.08
const DEFAULT_MIN_SCORE = 0.12
const REUSE_THRESHOLD = 0.62
const ADAPT_THRESHOLD = 0.32

/**
 * Which of a competency's terms this answer actually contains, and how
 * prominently. A term in the answer's own competency label is worth much more
 * than the same term buried in the body, where it may be incidental.
 */
const FIELD_WEIGHTS = { competency: 1, prompt: 0.6, body: 0.3 }

/**
 * Find banked answers worth adapting for a new competency question.
 *
 * PURE. No model call, no database, no clock. This is the function that makes
 * the answer bank compound: the fifteenth application is faster than the first
 * because the student is reworking a Result rather than staring at an empty
 * box, and no model call is needed to tell them which one to open.
 *
 * Scoring is 60% competency family, 40% lexical overlap, plus a small bonus for
 * an answer that already has a measured result. Family dominates deliberately:
 * two answers can share a lot of vocabulary ("deadline", "team", "college")
 * while evidencing completely different things, and recommending the wrong
 * competency wastes more of a student's time than recommending nothing.
 *
 * Recency is a tie-break only, never a score component. The best answer to
 * reuse is the strongest one, not the newest one.
 */
export function matchAnswersForCompetency(
  competency: string,
  candidates: ReuseCandidate[],
  options: ReuseOptions = {},
): ReuseMatch[] {
  const { prompt = '', limit = 5, excludeAnswerId, minScore = DEFAULT_MIN_SCORE } = options

  const targetTerms = [...new Set([...tokenize(competency), ...tokenize(prompt)])]
  const targetFamily = detectCompetencyFamily(`${competency} ${prompt}`)
  if (!targetTerms.length && !targetFamily) return []

  const matches: ReuseMatch[] = []

  for (const candidate of candidates) {
    if (excludeAnswerId && candidate._id === excludeAnswerId) continue

    const fields = {
      competency: new Set(tokenize(candidate.competency)),
      prompt: new Set(tokenize(candidate.prompt)),
      body: new Set(tokenize(candidate.body)),
    }

    // Lexical half: what share of the target's terms appear, weighted by where.
    let weighted = 0
    const strongHits: string[] = []
    for (const term of targetTerms) {
      if (fields.competency.has(term)) {
        weighted += FIELD_WEIGHTS.competency
        strongHits.push(term)
      } else if (fields.prompt.has(term)) {
        weighted += FIELD_WEIGHTS.prompt
        strongHits.push(term)
      } else if (fields.body.has(term)) {
        weighted += FIELD_WEIGHTS.body
      }
    }
    const lexical = targetTerms.length ? Math.min(1, weighted / targetTerms.length) : 0

    // Family half.
    const candidateFamily = detectCompetencyFamily(`${candidate.competency} ${candidate.prompt}`)
    let family = 0
    const reasons: string[] = []
    if (targetFamily && candidateFamily) {
      if (targetFamily === candidateFamily) {
        family = 1
        reasons.push(`Same competency: ${FAMILY_LABELS[targetFamily] ?? targetFamily}`)
      } else if (isAdjacent(targetFamily, candidateFamily)) {
        family = 0.5
        reasons.push(
          `Close competency: a ${FAMILY_LABELS[candidateFamily] ?? candidateFamily} answer usually ` +
            `reworks into ${FAMILY_LABELS[targetFamily] ?? targetFamily}`,
        )
      }
    }

    const signals = starSignals(candidate.body)
    const starReady = candidate.starComplete ?? signals.complete

    let score = FAMILY_WEIGHT * family + LEXICAL_WEIGHT * lexical
    if (starReady) score += STAR_BONUS
    score = Math.min(1, score)
    if (score < minScore) continue

    if (strongHits.length) {
      reasons.push(`Shares wording: ${strongHits.slice(0, 3).map((t) => `"${t}"`).join(', ')}`)
    }
    if (starReady) reasons.push('Already has a measured result')

    // The caution is the honest half. A high-scoring answer with no result in
    // it is not ready to paste anywhere, and saying so here is cheaper than
    // spending a model call to say it later.
    let caution: string | undefined
    if (!signals.hasResult) caution = 'No clear result yet - add what changed before you reuse this'
    else if (!signals.hasNumbers) caution = 'The result is not measured - add a number'
    else if (signals.ownership < 0.5) caution = 'Mostly written as "we" - rewrite it as what you did'
    else if (family < 1) caution = 'Rework the Action and Result to point at the new competency'

    // An answer with no measured result is never "reuse", however well it
    // matches the competency. Labelling a half-finished answer as ready to go
    // is the one failure this feature cannot have: the student pastes it,
    // submits it, and we have actively made the application worse. A perfect
    // topic match with no Result in it is an adaptation, and it is honest to
    // say so.
    const band: ReuseFit =
      score >= REUSE_THRESHOLD ? 'reuse' : score >= ADAPT_THRESHOLD ? 'adapt' : 'stretch'
    const fit: ReuseFit = band === 'reuse' && !starReady ? 'adapt' : band

    matches.push({
      answerId: candidate._id,
      score: Math.round(score * 1000) / 1000,
      fit,
      reasons,
      caution,
    })
  }

  const order = new Map(candidates.map((c, i) => [c._id, i]))
  const updated = new Map(candidates.map((c) => [c._id, c.updatedAt]))
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        (updated.get(b.answerId) ?? 0) - (updated.get(a.answerId) ?? 0) ||
        (order.get(a.answerId) ?? 0) - (order.get(b.answerId) ?? 0),
    )
    .slice(0, limit)
}

// ============================================================================
// Metering
// ============================================================================
//
// A coaching action is a model call. It costs what a chat message costs and it
// is capped the same way, or a user with the answer bank open all evening is a
// user we lose money on.
//
// Two gates, both server-side and both before the spend:
//
//   Daily   - shared with chat. Coaching draws from the same daily allowance as
//             messages, so a user cannot get a second day's worth of model by
//             switching tab. Chat messages are counted from `messages`;
//             coaching runs are counted from the rows they leave behind.
//   Monthly - the cost ceiling from tiers.ts, charged UP FRONT at the worst
//             case (actual input tokens + the tier's maximum output) and
//             reconciled down once the real usage is known. Charging after the
//             fact means a burst of concurrent actions can each pass a check
//             that the others have already invalidated.
//
// KNOWN GAP, deliberate, needs a schema change to close: only critiques and
// rejection debriefs leave a countable row. Competitiveness checks and
// interview turns have no table, so they consume the monthly cost envelope
// (which is exact) but are invisible to the daily count. Closing it means
// either a `coachRuns` table or a `by_user` index on `critiques`; both are
// schema.ts changes, which this module does not own.

/** Rough size of a coaching prompt before the answer is added, in tokens. */
const RESERVE_FLOOR_TOKENS = 1500

/**
 * Convex generates `internal.coach.*` types from a deployment, and this module
 * post-dates the last codegen, so `internal.coach` does not type-check yet.
 * Referencing these by name keeps the file self-contained and correctly typed
 * without editing generated code; they collapse back to `internal.coach.x`
 * the next time `npx convex dev` runs.
 */
const refs = {
  beginRun: makeFunctionReference<
    'mutation',
    { kind: string; estimatedInputTokens: number },
    { tier: Tier; model: string; maxOutputTokens: number; reservedMicros: number }
  >('coach:beginRun'),
  settleRun: makeFunctionReference<
    'mutation',
    { tier: Tier; reservedMicros: number; inputTokens: number; outputTokens: number },
    null
  >('coach:settleRun'),
  critiqueContext: makeFunctionReference<
    'query',
    { answerId: string },
    { competency: string; prompt: string; body: string }
  >('coach:critiqueContext'),
  finishCritique: makeFunctionReference<
    'mutation',
    {
      answerId: string
      body: string
      strengths: string[]
      fixes: string[]
      tier: Tier
      reservedMicros: number
      inputTokens: number
      outputTokens: number
    },
    { critiqueId: string }
  >('coach:finishCritique'),
  schemeContext: makeFunctionReference<
    'query',
    { applicationId?: string; schemeId?: string; schemeName?: string },
    { facts: string; label: string }
  >('coach:schemeContext'),
  rejectionContext: makeFunctionReference<
    'query',
    { rejectionId: string },
    { stage: string; feedbackGiven: string; label: string }
  >('coach:rejectionContext'),
  finishDebrief: makeFunctionReference<
    'mutation',
    {
      rejectionId: string
      body: string
      actions: string[]
      tier: Tier
      reservedMicros: number
      inputTokens: number
      outputTokens: number
    },
    null
  >('coach:finishDebrief'),
}

/** Shared by every settle path, including the refund on a failed call. */
async function applySpend(
  ctx: { db: any },
  userId: Id<'users'>,
  tier: Tier,
  reservedMicros: number,
  inputTokens: number,
  outputTokens: number,
) {
  const actual = inputTokens || outputTokens ? costMicros(tier, inputTokens, outputTokens) : 0
  const delta = actual - reservedMicros
  const month = monthKey()
  const row = await ctx.db
    .query('usage')
    .withIndex('by_user_month', (q: any) => q.eq('userId', userId).eq('month', month))
    .unique()
  if (!row) return
  await ctx.db.patch(row._id, {
    // Clamped: a refund must never push a user's month negative and hand them
    // budget they did not have.
    costMicros: Math.max(0, row.costMicros + delta),
    inputTokens: row.inputTokens + inputTokens,
    outputTokens: row.outputTokens + outputTokens,
  })
}

/**
 * Coaching runs today.
 *
 * Every mode writes a `coachRuns` row, so this is one indexed read regardless
 * of how many answers the user has banked. It also closes the gap where
 * competitiveness checks and interview turns - which leave no critique or
 * rejection row - were invisible to the daily cap, letting a user take a second
 * day's allowance by switching feature.
 */
async function coachRunsSince(ctx: { db: any }, userId: Id<'users'>, since: number) {
  const runs = await ctx.db
    .query('coachRuns')
    .withIndex('by_user', (q: any) => q.eq('userId', userId).gte('createdAt', since))
    .collect()
  return runs.length
}

/**
 * Check both caps and reserve the worst-case cost, or throw.
 *
 * The `LIMIT:` prefix on the free-tier messages is the convention chat.ts uses
 * to tell the client to show the upgrade prompt rather than a plain error.
 */
export const beginRun = internalMutation({
  args: { kind: v.string(), estimatedInputTokens: v.number() },
  handler: async (ctx, { kind, estimatedInputTokens }) => {
    const user = await requireUser(ctx)
    const tier = TIERS[user.plan]

    const since = startOfDay()
    const chatToday = await ctx.db
      .query('messages')
      .withIndex('by_user', (q) => q.eq('userId', user._id).gte('createdAt', since))
      .filter((q) => q.eq(q.field('role'), 'user'))
      .collect()
    const coachToday = await coachRunsSince(ctx, user._id, since)
    if (chatToday.length + coachToday >= tier.dailyMessages) {
      throw new ConvexError(
        user.plan === 'pro'
          ? `You've hit today's limit of ${tier.dailyMessages} messages and coaching sessions. It resets at midnight UTC.`
          : `LIMIT:You've used today's ${tier.dailyMessages} free messages and coaching sessions. Upgrade to Pro for more, or come back tomorrow.`,
      )
    }

    const month = monthKey()
    const usage = await ctx.db
      .query('usage')
      .withIndex('by_user_month', (q) => q.eq('userId', user._id).eq('month', month))
      .unique()
    if ((usage?.costMicros ?? 0) >= tier.monthlyCostMicros) {
      throw new ConvexError(
        user.plan === 'pro'
          ? "You've used this month's Pro allowance. It resets on the 1st."
          : "LIMIT:You've used this month's free allowance. Upgrade to Pro to keep going.",
      )
    }

    // Reserve the worst case now. `settleRun` gives back the difference.
    const reservedMicros = costMicros(
      user.plan,
      Math.max(estimatedInputTokens, RESERVE_FLOOR_TOKENS),
      tier.maxOutputTokens,
    )
    if (usage) {
      await ctx.db.patch(usage._id, {
        messages: usage.messages + 1,
        costMicros: usage.costMicros + reservedMicros,
      })
    } else {
      await ctx.db.insert('usage', {
        userId: user._id,
        month,
        messages: 1,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: reservedMicros,
      })
    }
    // Recorded here rather than on success, so an abandoned or failed run still
    // counts against the daily cap. Otherwise a failing call is a free retry.
    await ctx.db.insert('coachRuns', {
      userId: user._id,
      mode: kind,
      costMicros: reservedMicros,
      createdAt: Date.now(),
    })

    console.log(`coach run reserved: ${kind}, ${reservedMicros} micros, plan ${user.plan}`)
    return {
      tier: user.plan,
      model: tier.model,
      maxOutputTokens: tier.maxOutputTokens,
      reservedMicros,
    }
  },
})

/** Reconcile a reservation against what the call actually cost. */
export const settleRun = internalMutation({
  args: {
    tier: tierValidator,
    reservedMicros: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, { tier, reservedMicros, inputTokens, outputTokens }) => {
    const user = await requireUser(ctx)
    await applySpend(ctx, user._id, tier, reservedMicros, inputTokens, outputTokens)
    return null
  },
})

// ============================================================================
// Model call and retrieval
// ============================================================================

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Tokens of retrieved GTOD knowledge allowed into one coaching call. */
const RETRIEVAL_TOKEN_BUDGET = 2000
const CANDIDATES = 12

/**
 * Retrieve the GTOD knowledge worth putting behind a coaching reply.
 *
 * Mirrors the strategy in chat.ts (BM25 always, vector fused in when an
 * embedding provider is configured, lexical-only when not). The helper there is
 * module-private and chat.ts is not ours to change, so the strategy is repeated
 * rather than the file edited. If a third caller appears, lift it into
 * retrieval.ts.
 *
 * Coaching grounds in the same corpus as chat for a reason: our critique of a
 * competency answer has to agree with what Charge told the same student about
 * competency answers yesterday.
 */
async function retrieve(ctx: any, question: string) {
  if (!question.trim()) return []
  const chunks = await ctx.runQuery(internal.knowledge.allChunks, {})
  if (!chunks.length) return []

  const lexical = bm25(question, chunks)
    .slice(0, CANDIDATES)
    .map((r: { chunk: any }) => r.chunk)
  const rankings = [lexical]

  if (embeddingConfig()) {
    try {
      const [vector] = (await embed([question])) ?? []
      if (vector) {
        const hits = await ctx.vectorSearch('knowledgeChunks', 'by_embedding', { vector, limit: CANDIDATES })
        const semantic = await ctx.runQuery(internal.knowledge.chunksByIds, {
          ids: hits.map((h: { _id: string }) => h._id),
        })
        if (semantic.length) rankings.push(semantic)
      }
    } catch (err) {
      console.error('vector retrieval failed, continuing lexically', err)
    }
  }

  return selectChunks(fuse(rankings, (c: any) => String(c._id)), { tokenBudget: RETRIEVAL_TOKEN_BUDGET })
}

interface ModelReply {
  content: string
  inputTokens: number
  outputTokens: number
}

/**
 * One non-streaming completion through OpenRouter.
 *
 * Same endpoint, headers and auth as chat.ts; not streamed because a coaching
 * reply is written into a row once it is complete rather than rendered token by
 * token, so streaming would buy nothing and cost a write per chunk.
 */
async function callModel(opts: {
  model: string
  maxOutputTokens: number
  temperature: number
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}): Promise<ModelReply> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new ConvexError("Charge isn't configured yet (OPENROUTER_API_KEY missing).")

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': process.env.SITE_URL ?? 'https://getthereoneday.com',
      'X-Title': 'Charge by Get There One Day',
    },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ConvexError(`OpenRouter returned ${res.status}: ${text.slice(0, 300)}`)
  }
  const json: any = await res.json()
  const content: string = json.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) throw new ConvexError('The model returned nothing. Try again in a moment.')
  return {
    content,
    inputTokens: json.usage?.prompt_tokens ?? estimateTokens(opts.system + opts.messages.map((m) => m.content).join('')),
    outputTokens: json.usage?.completion_tokens ?? estimateTokens(content),
  }
}

/**
 * Reserve, call, settle. Every metered coaching path goes through this so no
 * future mode can forget the budget, and so a failed call refunds its
 * reservation rather than charging a student for our outage.
 */
async function runCoach(
  ctx: any,
  opts: {
    mode: CoachMode
    system: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    temperature?: number
  },
): Promise<ModelReply & { tier: Tier; reservedMicros: number }> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new ConvexError("Charge isn't configured yet (OPENROUTER_API_KEY missing).")
  }
  const estimatedInputTokens = estimateTokens(opts.system + opts.messages.map((m) => m.content).join(''))
  const run = await ctx.runMutation(refs.beginRun, { kind: opts.mode, estimatedInputTokens })
  try {
    const reply = await callModel({
      model: run.model,
      maxOutputTokens: run.maxOutputTokens,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages: opts.messages,
    })
    return { ...reply, tier: run.tier, reservedMicros: run.reservedMicros }
  } catch (err) {
    // Refund: no tokens were billed to us, so none should be billed to them.
    // A failed refund must not mask the failure that caused it - the user needs
    // to see why their coaching call broke, not why the bookkeeping did.
    try {
      await ctx.runMutation(refs.settleRun, {
        tier: run.tier,
        reservedMicros: run.reservedMicros,
        inputTokens: 0,
        outputTokens: 0,
      })
    } catch (refundErr) {
      console.error('failed to refund a coaching reservation', refundErr)
    }
    throw err
  }
}

// ============================================================================
// Answer bank CRUD
// ============================================================================

function cleanAnswer(competency: string, prompt: string, body: string) {
  const c = competency.trim().slice(0, MAX_COMPETENCY_CHARS)
  const p = prompt.trim().slice(0, MAX_PROMPT_CHARS)
  const b = body.trim().slice(0, MAX_ANSWER_CHARS)
  if (!c) throw new ConvexError('Give the answer a competency, so you can find it again')
  if (!b) throw new ConvexError('There is nothing to save yet')
  return { competency: c, prompt: p, body: b }
}

export const saveAnswer = mutation({
  args: { competency: v.string(), prompt: v.optional(v.string()), body: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const fields = cleanAnswer(args.competency, args.prompt ?? '', args.body)
    const now = Date.now()
    return ctx.db.insert('answers', {
      userId: user._id,
      ...fields,
      // Free structural read, so the bank can show readiness without a model
      // call. `critiqueAnswer` is the real judgement.
      starComplete: starSignals(fields.body).complete,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const updateAnswer = mutation({
  args: {
    answerId: v.id('answers'),
    competency: v.optional(v.string()),
    prompt: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, { answerId, ...patch }) => {
    const user = await requireUser(ctx)
    const answer = await ctx.db.get(answerId)
    if (!answer || answer.userId !== user._id) throw new ConvexError('Answer not found')
    const fields = cleanAnswer(
      patch.competency ?? answer.competency,
      patch.prompt ?? answer.prompt,
      patch.body ?? answer.body,
    )
    await ctx.db.patch(answerId, {
      ...fields,
      starComplete: starSignals(fields.body).complete,
      updatedAt: Date.now(),
    })
    return answerId
  },
})

export const deleteAnswer = mutation({
  args: { answerId: v.id('answers') },
  handler: async (ctx, { answerId }) => {
    const user = await requireUser(ctx)
    const answer = await ctx.db.get(answerId)
    if (!answer || answer.userId !== user._id) throw new ConvexError('Answer not found')
    // Critiques are meaningless without the answer they critique, so they go
    // with it rather than being orphaned in the table forever.
    const critiques = await ctx.db
      .query('critiques')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect()
    for (const critique of critiques) await ctx.db.delete(critique._id)
    await ctx.db.delete(answerId)
    return null
  },
})

/**
 * The user's answer bank, newest first.
 *
 * `signals` is recomputed on read rather than trusted from the row: the
 * heuristic will improve, and a stale `starComplete` written by an older
 * version of it would quietly mislead.
 */
export const myAnswers = query({
  args: { competency: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { competency, limit }) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const rows = competency
      ? await ctx.db
          .query('answers')
          .withIndex('by_user_competency', (q) => q.eq('userId', user._id).eq('competency', competency))
          .collect()
      : await ctx.db
          .query('answers')
          .withIndex('by_user', (q) => q.eq('userId', user._id))
          .order('desc')
          .take(Math.min(limit ?? 100, 200))
    return rows.map((row) => ({
      _id: row._id,
      competency: row.competency,
      prompt: row.prompt,
      body: row.body,
      starComplete: row.starComplete ?? false,
      lastCritiqueAt: row.lastCritiqueAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      signals: starSignals(row.body),
      family: detectCompetencyFamily(`${row.competency} ${row.prompt}`),
    }))
  },
})

/** Critique history for one answer, so a student can see they are improving. */
export const answerCritiques = query({
  args: { answerId: v.id('answers') },
  handler: async (ctx, { answerId }) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const answer = await ctx.db.get(answerId)
    if (!answer || answer.userId !== user._id) return []
    return ctx.db
      .query('critiques')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .order('desc')
      .take(20)
  },
})

// ============================================================================
// suggestAnswerReuse - the compounding bit, and it costs nothing
// ============================================================================

/**
 * Which banked answers could be adapted for this competency.
 *
 * No model call, by design. This runs every time a student opens a new
 * application form, which at the scale we want would be an enormous number of
 * model calls for a question that is genuinely answerable with matching. It is
 * therefore also unmetered, and free on both tiers - the feature that makes the
 * bank worth building must not be rationed.
 */
export const suggestAnswerReuse = query({
  args: {
    competency: v.string(),
    prompt: v.optional(v.string()),
    limit: v.optional(v.number()),
    excludeAnswerId: v.optional(v.id('answers')),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx)
    if (!user) return { family: null as string | null, matches: [] }
    const rows = await ctx.db
      .query('answers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(200)

    const matches = matchAnswersForCompetency(args.competency, rows, {
      prompt: args.prompt,
      limit: Math.min(args.limit ?? 5, 20),
      excludeAnswerId: args.excludeAnswerId,
    })

    const byId = new Map(rows.map((r) => [String(r._id), r]))
    return {
      family: detectCompetencyFamily(`${args.competency} ${args.prompt ?? ''}`),
      matches: matches.map((m) => {
        const row = byId.get(m.answerId)!
        return {
          ...m,
          competency: row.competency,
          prompt: row.prompt,
          // Enough to recognise it without shipping the whole bank to the client.
          excerpt: row.body.slice(0, 240),
          updatedAt: row.updatedAt,
        }
      }),
    }
  },
})

// ============================================================================
// critiqueAnswer
// ============================================================================

export const critiqueContext = internalQuery({
  args: { answerId: v.id('answers') },
  handler: async (ctx, { answerId }) => {
    const user = await requireUser(ctx)
    const answer = await ctx.db.get(answerId)
    if (!answer || answer.userId !== user._id) throw new ConvexError('Answer not found')
    return { competency: answer.competency, prompt: answer.prompt, body: answer.body }
  },
})

export const finishCritique = internalMutation({
  args: {
    answerId: v.id('answers'),
    body: v.string(),
    strengths: v.array(v.string()),
    fixes: v.array(v.string()),
    tier: tierValidator,
    reservedMicros: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const answer = await ctx.db.get(args.answerId)
    if (!answer || answer.userId !== user._id) throw new ConvexError('Answer not found')
    const now = Date.now()
    const critiqueId = await ctx.db.insert('critiques', {
      answerId: args.answerId,
      userId: user._id,
      body: args.body,
      strengths: args.strengths.length ? args.strengths : undefined,
      fixes: args.fixes.length ? args.fixes : undefined,
      createdAt: now,
    })
    // `updatedAt` is left alone: a critique is not an edit by the student, and
    // moving it would reorder their bank underneath them.
    await ctx.db.patch(args.answerId, { lastCritiqueAt: now })
    await applySpend(ctx, user._id, args.tier, args.reservedMicros, args.inputTokens, args.outputTokens)
    return { critiqueId: String(critiqueId) }
  },
})

/**
 * Critique one banked answer against the STAR format.
 *
 * Returns the prose plus the parsed strengths and fixes. Never returns a
 * rewritten answer - see COMPETENCY_CRITIQUE for how that is enforced, and note
 * that nothing in this function would store one if the model produced it: the
 * critique goes in `critiques`, and `answers.body` is only ever written by the
 * student's own mutation.
 */
export const critiqueAnswer = action({
  args: { answerId: v.id('answers') },
  handler: async (
    ctx,
    { answerId },
  ): Promise<{ critiqueId: string; body: string; strengths: string[]; fixes: string[] }> => {
    const answer = await ctx.runQuery(refs.critiqueContext, { answerId })

    const extracts = await retrieve(
      ctx,
      `${answer.competency} competency answer STAR structure result ${answer.prompt}`,
    )

    const signals = starSignals(answer.body)
    // The signals ride along as an observation, not an instruction: they are
    // cheap and often right, and giving the model the "we/I" ratio up front
    // stops it having to eyeball a count it is bad at.
    const turn = [
      `Competency being assessed: ${answer.competency}`,
      answer.prompt ? `The employer's question: ${answer.prompt}` : 'The employer\'s question was not recorded.',
      '',
      "The student's answer:",
      '"""',
      answer.body,
      '"""',
      '',
      '(Automatic checks, for your information only - use your own judgement: ' +
        `result phrase present: ${signals.hasResult ? 'yes' : 'no'}; ` +
        `contains a number: ${signals.hasNumbers ? 'yes' : 'no'}; ` +
        `first-person share of person words: ${Math.round(signals.ownership * 100)}%; ` +
        `length: ${signals.words} words.)`,
    ].join('\n')

    const reply = await runCoach(ctx, {
      mode: 'critique',
      system: COACH_PROMPTS.critique,
      messages: [{ role: 'user', content: buildUserTurn(turn, extracts) }],
      temperature: 0.35,
    })

    const parsed = parseCritique(reply.content)
    const { critiqueId } = await ctx.runMutation(refs.finishCritique, {
      answerId,
      body: parsed.body,
      strengths: parsed.strengths,
      fixes: parsed.fixes,
      tier: reply.tier,
      reservedMicros: reply.reservedMicros,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    })
    return { critiqueId, body: parsed.body, strengths: parsed.strengths, fixes: parsed.fixes }
  },
})

// ============================================================================
// checkCompetitiveness
// ============================================================================

/**
 * Everything we actually know about a scheme, formatted as facts the model may
 * use and nothing else.
 *
 * The `verified` flag is passed through verbatim and labelled. Rule 4 of the
 * build plan is that Charge cites or says it does not know; an unverified entry
 * requirement presented as fact in a competitiveness read is exactly the sort
 * of thing that would send a student away from an application they could have
 * won, or towards one they could not.
 */
export const schemeContext = internalQuery({
  args: {
    applicationId: v.optional(v.id('applications')),
    schemeId: v.optional(v.id('schemes')),
    schemeName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let schemeId = args.schemeId
    let label = args.schemeName?.trim().slice(0, 200) ?? ''

    if (args.applicationId) {
      const application = await ctx.db.get(args.applicationId)
      if (!application || application.userId !== user._id) throw new ConvexError('Application not found')
      schemeId = application.schemeId ?? schemeId
      if (!label) {
        label = [application.customEmployer, application.customName].filter(Boolean).join(' - ')
      }
    }

    if (!schemeId) {
      if (!label) throw new ConvexError('Tell me which scheme you mean')
      return {
        label,
        facts: [
          `Scheme: ${label}`,
          'We hold no verified record of this scheme, so we have no entry requirements for it.',
          "Say so plainly and tell the student to check the employer's own scheme page for the",
          'stated requirements. Do not guess what they are.',
        ].join('\n'),
      }
    }

    const scheme = await ctx.db.get(schemeId)
    if (!scheme) throw new ConvexError('Scheme not found')
    const lines = [
      `Scheme: ${scheme.employer} - ${scheme.name}`,
      scheme.level ? `Level: ${scheme.level}` : null,
      scheme.sector ? `Sector: ${scheme.sector}` : null,
      scheme.locations?.length ? `Locations: ${scheme.locations.join(', ')}` : null,
      scheme.entryRequirements
        ? `Stated entry requirements: ${scheme.entryRequirements}`
        : 'Stated entry requirements: we do not hold these. Do not guess them; tell the student to check the scheme page.',
      scheme.salary ? `Salary: ${scheme.salary}` : null,
      scheme.closesAt ? `Closes: ${new Date(scheme.closesAt).toISOString().slice(0, 10)}` : null,
      scheme.rolling ? 'Recruits on a rolling basis.' : null,
      scheme.notes ? `Notes: ${scheme.notes}` : null,
      `Source: ${scheme.url}`,
      scheme.verified
        ? 'These details have been verified against the employer by a human.'
        : 'WARNING: these details are NOT verified. Say so if you rely on them, and tell the student to confirm on the scheme page.',
    ].filter(Boolean)
    return { label: `${scheme.employer} - ${scheme.name}`, facts: lines.join('\n') }
  },
})

/**
 * An honest read on whether this student is in the running for this scheme.
 *
 * Not stored: there is no table for it, and a competitiveness read goes stale
 * the moment grades or the scheme change, so caching one would be worse than
 * not having it. It is metered like everything else.
 */
export const checkCompetitiveness = action({
  args: {
    applicationId: v.optional(v.id('applications')),
    schemeId: v.optional(v.id('schemes')),
    schemeName: v.optional(v.string()),
    grades: v.string(),
    experience: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ verdict: Verdict; body: string; scheme: string }> => {
    const grades = args.grades.trim().slice(0, 1000)
    if (!grades) throw new ConvexError('Tell me your grades - predicted is fine - so this is worth anything')

    const scheme = await ctx.runQuery(refs.schemeContext, {
      applicationId: args.applicationId,
      schemeId: args.schemeId,
      schemeName: args.schemeName,
    })

    const extracts = await retrieve(
      ctx,
      `${scheme.label} entry requirements grades eligibility degree apprenticeship application`,
    )

    const turn = [
      '# The scheme, as we hold it',
      scheme.facts,
      '',
      '# What the student says about themselves',
      `Grades (as stated by them, predicted or achieved): ${grades}`,
      args.experience?.trim()
        ? `Experience: ${args.experience.trim().slice(0, 2000)}`
        : 'Experience: they have not told us. Ask for it only if it would change the reading.',
      '',
      'Give them the honest read.',
    ].join('\n')

    const reply = await runCoach(ctx, {
      mode: 'competitiveness',
      system: COACH_PROMPTS.competitiveness,
      messages: [{ role: 'user', content: buildUserTurn(turn, extracts) }],
      temperature: 0.3,
    })

    await ctx.runMutation(refs.settleRun, {
      tier: reply.tier,
      reservedMicros: reply.reservedMicros,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    })

    const parsed = parseCompetitiveness(reply.content)
    return { verdict: parsed.verdict, body: parsed.body, scheme: scheme.label }
  },
})

// ============================================================================
// Rejections
// ============================================================================

/**
 * Record a rejection.
 *
 * A plain mutation with no model call, so it is free and unmetered: the cost of
 * logging a rejection must be zero or people will not log them, and the debrief
 * is worthless without the log. The debrief is a separate, metered action so
 * that recording one and processing it are different decisions.
 *
 * Note this does NOT move the linked application to `rejected`. Stage
 * transitions belong to the timeline module, which generates tasks off them;
 * two modules writing the same field is how a stage ends up flapping.
 */
export const logRejection = mutation({
  args: {
    applicationId: v.optional(v.id('applications')),
    stage: v.string(),
    feedbackGiven: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (args.applicationId) {
      const application = await ctx.db.get(args.applicationId)
      if (!application || application.userId !== user._id) throw new ConvexError('Application not found')
    }
    const stage = args.stage.trim().slice(0, 120)
    if (!stage) throw new ConvexError('Which stage did it end at?')
    return ctx.db.insert('rejections', {
      userId: user._id,
      applicationId: args.applicationId,
      stage,
      feedbackGiven: args.feedbackGiven?.trim().slice(0, 4000) || undefined,
      createdAt: Date.now(),
    })
  },
})

export const myRejections = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const user = await currentUser(ctx)
    if (!user) return []
    return ctx.db
      .query('rejections')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(Math.min(limit ?? 25, 100))
  },
})

export const rejectionContext = internalQuery({
  args: { rejectionId: v.id('rejections') },
  handler: async (ctx, { rejectionId }) => {
    const user = await requireUser(ctx)
    const rejection = await ctx.db.get(rejectionId)
    if (!rejection || rejection.userId !== user._id) throw new ConvexError('Rejection not found')

    let label = 'a scheme they applied to'
    if (rejection.applicationId) {
      const application = await ctx.db.get(rejection.applicationId)
      if (application && application.userId === user._id) {
        if (application.schemeId) {
          const scheme = await ctx.db.get(application.schemeId)
          if (scheme) label = `${scheme.employer} - ${scheme.name}`
        } else {
          label = [application.customEmployer, application.customName].filter(Boolean).join(' - ') || label
        }
      }
    }
    return { stage: rejection.stage, feedbackGiven: rejection.feedbackGiven ?? '', label }
  },
})

export const finishDebrief = internalMutation({
  args: {
    rejectionId: v.id('rejections'),
    body: v.string(),
    actions: v.array(v.string()),
    tier: tierValidator,
    reservedMicros: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const rejection = await ctx.db.get(args.rejectionId)
    if (!rejection || rejection.userId !== user._id) throw new ConvexError('Rejection not found')
    await ctx.db.patch(args.rejectionId, {
      debrief: args.body,
      actions: args.actions.length ? args.actions : undefined,
    })
    await applySpend(ctx, user._id, args.tier, args.reservedMicros, args.inputTokens, args.outputTokens)
    return null
  },
})

/**
 * Turn a logged rejection into one or two named improvements.
 *
 * The debrief is stored on the rejection row, so a student can look back over a
 * season and see the same fix recurring - which is itself the most useful
 * pattern this feature can surface.
 */
export const debriefRejection = action({
  args: { rejectionId: v.id('rejections') },
  handler: async (ctx, { rejectionId }): Promise<{ body: string; actions: string[] }> => {
    const rejection = await ctx.runQuery(refs.rejectionContext, { rejectionId })

    const extracts = await retrieve(
      ctx,
      `rejected at ${rejection.stage} apprenticeship application what to do next ${rejection.feedbackGiven}`,
    )

    const turn = [
      `Scheme: ${rejection.label}`,
      `Stage they were rejected at: ${rejection.stage}`,
      rejection.feedbackGiven
        ? `Feedback the employer gave, in their words:\n"""\n${rejection.feedbackGiven}\n"""`
        : 'The employer gave no feedback. Diagnose from the stage alone and say that is what you are doing.',
    ].join('\n')

    const reply = await runCoach(ctx, {
      mode: 'rejection',
      system: COACH_PROMPTS.rejection,
      messages: [{ role: 'user', content: buildUserTurn(turn, extracts) }],
      temperature: 0.45,
    })

    const parsed = parseDebrief(reply.content)
    await ctx.runMutation(refs.finishDebrief, {
      rejectionId,
      body: parsed.body,
      actions: parsed.actions,
      tier: reply.tier,
      reservedMicros: reply.reservedMicros,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    })
    return { body: parsed.body, actions: parsed.actions }
  },
})

// ============================================================================
// Interview practice
// ============================================================================

/** Turns of history sent back to the model. One turn is a Q and an A. */
const MAX_INTERVIEW_TURNS = 16

/**
 * One turn of a text mock interview.
 *
 * Stateless on the server: there is no table for a practice session, so the
 * client holds the transcript and sends it back. That is fine for text (the
 * transcript is short and the student owns it) and keeps this out of schema.ts,
 * which this module does not own. Voice sessions, when they land, have
 * `voiceSessions` for exactly this.
 *
 * Metered per turn, because every turn is a model call.
 */
export const interviewTurn = action({
  args: {
    // Role, employer and stage, if the student has told us. Free text so the
    // client can pass through an application or something typed by hand.
    context: v.optional(v.string()),
    history: v.array(
      v.object({
        role: v.union(v.literal('user'), v.literal('assistant')),
        content: v.string(),
      }),
    ),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ reply: string }> => {
    const history = args.history
      .slice(-MAX_INTERVIEW_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    const message = args.message?.trim().slice(0, MAX_ANSWER_CHARS) ?? ''

    // An empty first message is how a session starts: the client says "begin"
    // and the interviewer opens.
    const opening = !history.length && !message

    const extracts = await retrieve(
      ctx,
      `apprenticeship interview questions competency ${args.context ?? ''} ${message}`.slice(0, 500),
    )

    const messages: { role: 'user' | 'assistant'; content: string }[] = [...history]
    const framing = args.context?.trim()
      ? `Context for this practice: ${args.context.trim().slice(0, 500)}`
      : 'The student has not said which role or employer this is for.'
    const turn = opening
      ? `${framing}\n\nStart the mock interview.`
      : `${framing}\n\n${message || '(The student sent nothing. Prompt them gently and re-ask your last question.)'}`
    messages.push({ role: 'user', content: buildUserTurn(turn, extracts) })

    const reply = await runCoach(ctx, {
      mode: 'interview',
      system: COACH_PROMPTS.interview,
      messages,
      // Warmer than the critique modes: an interviewer that phrases every
      // question identically stops being practice after three turns.
      temperature: 0.7,
    })

    await ctx.runMutation(refs.settleRun, {
      tier: reply.tier,
      reservedMicros: reply.reservedMicros,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    })
    return { reply: reply.content }
  },
})
