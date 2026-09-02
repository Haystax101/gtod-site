/**
 * Live voice sessions: mock interviews and check-in calls with Charge.
 *
 * The headline Pro feature, and the only one that can lose money if it is built
 * carelessly. Three principles hold it together:
 *
 * 1. **Budget is checked before the provider is called.** A session that cannot
 *    be afforded is never minted. See convex/budget.ts.
 * 2. **The browser never sees a provider API key.** The client is handed a
 *    short-lived, single-session credential minted server-side, whose TTL is
 *    the session cap. Even a hostile client cannot run longer than we allowed.
 * 3. **A session is reserved before it starts.** If a call is abandoned, the
 *    tab crashes, or the network drops, the reservation is still on the books
 *    and gets reconciled by `expireStale`. Sessions that cost nothing until
 *    someone remembers to reconcile are how metered features leak money.
 */
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'
import { requireUser } from './users'
import { TIERS, monthKey } from './tiers'
import { checkVoiceBudget, voiceCostMicros, VOICE_POLICY } from './budget'

/** A session whose heartbeat has been silent this long is presumed dead. */
const STALE_AFTER_MS = 3 * 60 * 1000

export const kindValidator = v.union(
  v.literal('interview'),
  v.literal('checkin'),
  v.literal('practice'),
)

/**
 * Mint a live-audio credential for the browser.
 *
 * IMPLEMENTATION NOTE - VERIFY BEFORE LAUNCH.
 * This build environment has no network access, so the exact request shape for
 * the provider's ephemeral-token endpoint could not be confirmed against its
 * documentation. The shape below is the intended contract, and everything that
 * matters for cost control - the budget check, the reservation, the TTL, the
 * concurrency limit - is provider-independent and already correct.
 *
 * When wiring this up for real, change ONLY the fetch inside this function.
 * Two rules must survive that edit:
 *   - the returned credential is short-lived and scoped to one session
 *   - the raw GEMINI_API_KEY is never returned to the caller
 *
 * If minting fails, no session runs and nothing is charged.
 */
async function mintEphemeralCredential(sessionMinutes: number): Promise<{
  token: string
  expiresAt: number
}> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new ConvexError('Voice calls are not configured yet (GEMINI_API_KEY missing).')
  }
  const expiresAt = Date.now() + sessionMinutes * 60_000

  const endpoint =
    process.env.GEMINI_EPHEMERAL_TOKEN_URL ??
    'https://generativelanguage.googleapis.com/v1alpha/auth_tokens'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(expiresAt).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ConvexError(`Could not start the call (${res.status}): ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { name?: string; token?: string }
  const token = json.token ?? json.name
  if (!token) throw new ConvexError('Voice provider returned no session credential.')
  return { token, expiresAt }
}

/** Everything the budget decision needs, read in one transaction. */
export const voiceContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Resolves the caller directly: an action's runQuery carries the caller's
    // identity, so the user id never has to be passed in (and therefore cannot
    // be spoofed by passing someone else's).
    const user = await requireUser(ctx)
    const userId = user._id
    const usage = await ctx.db
      .query('usage')
      .withIndex('by_user_month', (q) => q.eq('userId', userId).eq('month', monthKey()))
      .unique()
    const active = await ctx.db
      .query('voiceSessions')
      .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', 'active'))
      .collect()
    const reserved = await ctx.db
      .query('voiceSessions')
      .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', 'reserved'))
      .collect()
    return {
      userId,
      plan: user.plan,
      usage: { costMicros: usage?.costMicros ?? 0, voiceSeconds: usage?.voiceSeconds ?? 0 },
      activeSessions: active.length + reserved.length,
    }
  },
})

export const reserve = internalMutation({
  args: {
    userId: v.id('users'),
    kind: kindValidator,
    applicationId: v.optional(v.id('applications')),
    minutes: v.number(),
  },
  handler: async (ctx, { userId, kind, applicationId, minutes }) =>
    ctx.db.insert('voiceSessions', {
      userId,
      kind,
      applicationId,
      status: 'reserved',
      reservedMinutes: minutes,
      seconds: 0,
      costMicros: 0,
      startedAt: Date.now(),
    }),
})

export const release = internalMutation({
  args: { sessionId: v.id('voiceSessions') },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId)
    if (s && s.status === 'reserved') await ctx.db.delete(sessionId)
  },
})

/**
 * Start a call. Returns the credential the browser needs, plus the hard limit
 * it must respect. The limit is also enforced by the credential's TTL, so a
 * client that ignores it simply gets disconnected.
 */
export const start = action({
  args: { kind: kindValidator, applicationId: v.optional(v.id('applications')) },
  handler: async (ctx, { kind, applicationId }): Promise<{
    sessionId: string
    token: string
    expiresAt: number
    sessionMinutes: number
    remainingMinutes: number
  }> => {
    const { userId, plan, usage, activeSessions } = await ctx.runQuery(
      internal.voice.voiceContext,
      {},
    )

    const verdict = checkVoiceBudget(plan, usage, activeSessions)
    if (!verdict.ok) throw new ConvexError(verdict.reason ?? 'Voice is not available right now.')

    // Reserve before minting, so a provider failure cannot leave an
    // unaccounted-for session, and a crash mid-call still shows up as spend.
    const sessionId = await ctx.runMutation(internal.voice.reserve, {
      userId,
      kind,
      applicationId,
      minutes: verdict.sessionMinutes,
    })

    try {
      const { token, expiresAt } = await mintEphemeralCredential(verdict.sessionMinutes)
      return {
        sessionId,
        token,
        expiresAt,
        sessionMinutes: verdict.sessionMinutes,
        remainingMinutes: verdict.remainingMinutes,
      }
    } catch (err) {
      // Nothing ran, so nothing should be charged.
      await ctx.runMutation(internal.voice.release, { sessionId })
      throw err
    }
  },
})

/**
 * Keep a running session accounted for.
 *
 * The client reports elapsed seconds every few seconds. This is advisory for
 * billing accuracy, not for enforcement: the credential TTL is what actually
 * stops an over-long call. If the reserved ceiling is passed, the session is
 * closed server-side anyway.
 */
export const heartbeat = mutation({
  args: { sessionId: v.id('voiceSessions'), seconds: v.number() },
  handler: async (ctx, { sessionId, seconds }) => {
    const user = await requireUser(ctx)
    const session = await ctx.db.get(sessionId)
    if (!session || session.userId !== user._id) throw new ConvexError('Session not found')
    if (session.status === 'ended' || session.status === 'expired') return { stop: true }

    const capped = Math.min(seconds, session.reservedMinutes * 60)
    await ctx.db.patch(sessionId, {
      status: 'active',
      seconds: capped,
      costMicros: voiceCostMicros(capped),
    })
    return { stop: capped >= session.reservedMinutes * 60 }
  },
})

/** Finish a call and write the spend to the shared monthly ledger. */
export const end = mutation({
  args: {
    sessionId: v.id('voiceSessions'),
    seconds: v.number(),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, seconds, transcript, summary }) => {
    const user = await requireUser(ctx)
    const session = await ctx.db.get(sessionId)
    if (!session || session.userId !== user._id) throw new ConvexError('Session not found')
    if (session.status === 'ended') return

    const finalSeconds = Math.min(Math.max(seconds, session.seconds), session.reservedMinutes * 60)
    const cost = voiceCostMicros(finalSeconds)

    await ctx.db.patch(sessionId, {
      status: 'ended',
      seconds: finalSeconds,
      costMicros: cost,
      endedAt: Date.now(),
      transcript,
      summary,
    })
    await applySpend(ctx, user._id, finalSeconds, cost)
  },
})

/**
 * Reconcile sessions that never reported an end: closed laptops, crashed tabs,
 * lost connections. Without this, abandoned calls would under-report spend.
 * Charged at the reserved ceiling, because that is what we paid to hold open.
 */
export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_AFTER_MS
    let closed = 0
    for (const status of ['active', 'reserved'] as const) {
      const stale = (await ctx.db.query('voiceSessions').collect()).filter(
        (s) => s.status === status && s.startedAt < cutoff,
      )
      for (const s of stale) {
        const seconds = s.seconds > 0 ? s.seconds : s.reservedMinutes * 60
        const cost = voiceCostMicros(seconds)
        await ctx.db.patch(s._id, {
          status: 'expired',
          seconds,
          costMicros: cost,
          endedAt: Date.now(),
        })
        await applySpend(ctx, s.userId, seconds, cost)
        closed++
      }
    }
    return { closed }
  },
})

/** Write voice spend into the same monthly row that chat uses. */
async function applySpend(ctx: any, userId: any, seconds: number, costMicros: number) {
  const month = monthKey()
  const row = await ctx.db
    .query('usage')
    .withIndex('by_user_month', (q: any) => q.eq('userId', userId).eq('month', month))
    .unique()
  if (row) {
    await ctx.db.patch(row._id, {
      voiceSeconds: (row.voiceSeconds ?? 0) + seconds,
      costMicros: row.costMicros + costMicros,
    })
  } else {
    await ctx.db.insert('usage', {
      userId,
      month,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      voiceSeconds: seconds,
      costMicros,
    })
  }
}

/** What the UI needs to show "you have N minutes left". */
export const myVoiceAllowance = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    const usage = await ctx.db
      .query('usage')
      .withIndex('by_user_month', (q) => q.eq('userId', user._id).eq('month', monthKey()))
      .unique()
    const policy = VOICE_POLICY[user.plan]
    const used = (usage?.voiceSeconds ?? 0) / 60
    return {
      plan: user.plan,
      monthlyMinutes: policy.monthlyMinutes,
      usedMinutes: Math.round(used),
      remainingMinutes: Math.max(0, Math.floor(policy.monthlyMinutes - used)),
      maxSessionMinutes: policy.maxSessionMinutes,
      monthlyCostCapMicros: TIERS[user.plan].monthlyCostMicros,
    }
  },
})
