/**
 * Missions (the challenge list) and submissions (evidence against them).
 *
 * Evidence flow: the browser uploads audio straight to Convex storage, then
 * calls `submit`. The row starts as `processing` and classify.ts is scheduled
 * to transcribe and judge it. Confident verdicts apply themselves; anything
 * else lands in HQ's queue as `pending`. Link submissions skip the classifier
 * and go straight to `pending`, since we cannot fetch a TikTok.
 */
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { agentFromToken, log, publicAgent, requireAgent, requireLead } from './agents'

export const DEFAULT_PHRASE = 'You here for uni then?'
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024 // Groq's per-file ceiling
export const MAX_EVIDENCE_SECONDS = 180
const MAX_CLAIMED = 50
const SUBMISSIONS_PER_HOUR = 12
const HOUR = 60 * 60 * 1000
const PURGE_AFTER = 30 * 24 * HOUR

const LINK_RULE = /^https:\/\/(?:www\.|vm\.|m\.)?(?:tiktok\.com|youtube\.com|youtu\.be)\/\S+$/i

// ---------------------------------------------------------------- challenges

export const list = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!(await agentFromToken(ctx, token))) return null
    return ctx.db.query('challenges').withIndex('by_status', (q) => q.eq('status', 'active')).collect()
  },
})

export const listAll = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    return (await ctx.db.query('challenges').collect()).sort((a, b) => a.sortOrder - b.sortOrder)
  },
})

export const upsertChallenge = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.id('challenges')),
    title: v.string(),
    brief: v.string(),
    phrase: v.optional(v.string()),
    status: v.optional(v.union(v.literal('active'), v.literal('archived'))),
  },
  handler: async (ctx, { token, id, title, brief, phrase, status }) => {
    const lead = await requireLead(ctx, token)
    const fields = {
      title: title.trim().slice(0, 80),
      brief: brief.trim().slice(0, 600),
      phrase: (phrase?.trim() || DEFAULT_PHRASE).slice(0, 120),
    }
    if (!fields.title) throw new ConvexError('A mission needs a title')
    if (id) {
      await ctx.db.patch(id, { ...fields, ...(status ? { status } : {}) })
      await log(ctx, lead._id, 'challenge-edit', id, fields.title)
      return id
    }
    const count = (await ctx.db.query('challenges').collect()).length
    const newId = await ctx.db.insert('challenges', {
      ...fields,
      status: status ?? 'active',
      createdBy: lead._id,
      createdAt: Date.now(),
      sortOrder: count,
    })
    await log(ctx, lead._id, 'challenge-create', newId, fields.title)
    return newId
  },
})

// --------------------------------------------------------------- submissions

export const uploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireAgent(ctx, token)
    return ctx.storage.generateUploadUrl()
  },
})

export const submit = mutation({
  args: {
    token: v.string(),
    challengeId: v.optional(v.id('challenges')),
    freeformTitle: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    link: v.optional(v.string()),
    note: v.optional(v.string()),
    claimedCount: v.number(),
  },
  handler: async (ctx, args) => {
    const me = await requireAgent(ctx, args.token)

    if (!args.challengeId && !args.freeformTitle?.trim()) throw new ConvexError('Pick a mission or name your own.')
    if (!args.storageId && !args.link) throw new ConvexError('Evidence is required: a recording, or a link.')
    if (args.link && !LINK_RULE.test(args.link.trim())) throw new ConvexError('Links must be to TikTok or YouTube.')
    const claimedCount = Math.max(1, Math.min(MAX_CLAIMED, Math.round(args.claimedCount)))

    // Flood guard.
    const recent = await ctx.db
      .query('submissions')
      .withIndex('by_agent', (q) => q.eq('agentId', me._id).gt('createdAt', Date.now() - HOUR))
      .collect()
    if (recent.length >= SUBMISSIONS_PER_HOUR) throw new ConvexError('Slow down, agent. Try again in a bit.')

    let bytes: number | undefined
    if (args.storageId) {
      const meta = await ctx.db.system.get(args.storageId)
      if (!meta) throw new ConvexError('Upload not found')
      bytes = meta.size
      if (bytes > MAX_EVIDENCE_BYTES) {
        await ctx.storage.delete(args.storageId)
        throw new ConvexError('That file is too large (25 MB max). Trim it down and try again.')
      }
    }

    const id = await ctx.db.insert('submissions', {
      agentId: me._id,
      challengeId: args.challengeId,
      freeformTitle: args.freeformTitle?.trim().slice(0, 80) || undefined,
      storageId: args.storageId,
      mimeType: args.mimeType,
      bytes,
      durationSec: args.durationSec,
      link: args.link?.trim(),
      note: args.note?.trim().slice(0, 300) || undefined,
      claimedCount,
      status: args.storageId ? 'processing' : 'pending',
      createdAt: Date.now(),
    })
    if (args.storageId) await ctx.scheduler.runAfter(0, internal.classify.run, { submissionId: id })
    return id
  },
})

export const mine = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    const rows = await ctx.db.query('submissions').withIndex('by_agent', (q) => q.eq('agentId', me._id)).order('desc').take(50)
    return Promise.all(rows.map((s) => withChallenge(ctx, s)))
  },
})

/** Evidence playback. Only the owner and HQ get a URL, and only while it exists. */
export const evidenceUrl = query({
  args: { token: v.string(), submissionId: v.id('submissions') },
  handler: async (ctx, { token, submissionId }) => {
    const me = await requireAgent(ctx, token)
    const s = await ctx.db.get(submissionId)
    if (!s || !s.storageId) return null
    if (s.agentId !== me._id && me.rank !== 'lead') throw new ConvexError('Not yours')
    return ctx.storage.getUrl(s.storageId)
  },
})

export const queue = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const pending = await ctx.db.query('submissions').withIndex('by_status', (q) => q.eq('status', 'pending')).order('asc').take(100)
    const processing = await ctx.db.query('submissions').withIndex('by_status', (q) => q.eq('status', 'processing')).order('asc').take(20)
    return Promise.all([...pending, ...processing].map((s) => withAgentAndChallenge(ctx, s)))
  },
})

export const recent = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const approved = await ctx.db.query('submissions').withIndex('by_status', (q) => q.eq('status', 'approved')).order('desc').take(30)
    const rejected = await ctx.db.query('submissions').withIndex('by_status', (q) => q.eq('status', 'rejected')).order('desc').take(30)
    const rows = [...approved, ...rejected].sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0)).slice(0, 40)
    return Promise.all(rows.map((s) => withAgentAndChallenge(ctx, s)))
  },
})

/** The community feed: recently verified missions, names and counts only. */
export const feed = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!(await agentFromToken(ctx, token))) return null
    const rows = await ctx.db.query('submissions').withIndex('by_status', (q) => q.eq('status', 'approved')).order('desc').take(25)
    return Promise.all(
      rows.map(async (s) => {
        const a = await ctx.db.get(s.agentId)
        const c = s.challengeId ? await ctx.db.get(s.challengeId) : null
        return {
          _id: s._id,
          agent: a ? publicAgent(a) : null,
          title: c?.title ?? s.freeformTitle ?? 'Mission',
          verifiedCount: s.verifiedCount ?? 0,
          reviewedAt: s.reviewedAt ?? s.createdAt,
          auto: s.reviewedBy === 'auto',
        }
      }),
    )
  },
})

export const review = mutation({
  args: {
    token: v.string(),
    submissionId: v.id('submissions'),
    status: v.union(v.literal('approved'), v.literal('rejected')),
    verifiedCount: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, { token, submissionId, status, verifiedCount, reviewNote }) => {
    const lead = await requireLead(ctx, token)
    const s = await ctx.db.get(submissionId)
    if (!s) throw new ConvexError('No such submission')
    await applyReview(ctx, s, {
      status,
      verifiedCount: status === 'approved' ? Math.max(0, Math.round(verifiedCount ?? s.claimedCount)) : 0,
      reviewedBy: lead._id,
      reviewNote: reviewNote?.trim().slice(0, 300) || undefined,
    })
    await log(ctx, lead._id, `submission-${status}`, submissionId, { agentId: s.agentId, verifiedCount })
  },
})

/** HQ can send a stuck or errored submission back through the classifier. */
export const reanalyse = mutation({
  args: { token: v.string(), submissionId: v.id('submissions') },
  handler: async (ctx, { token, submissionId }) => {
    const lead = await requireLead(ctx, token)
    const s = await ctx.db.get(submissionId)
    if (!s) throw new ConvexError('No such submission')
    if (!s.storageId) throw new ConvexError('No recording to analyse')
    await ctx.db.patch(submissionId, { status: 'processing', classifierError: undefined })
    await ctx.scheduler.runAfter(0, internal.classify.run, { submissionId })
    await log(ctx, lead._id, 'submission-reanalyse', submissionId)
  },
})

// ------------------------------------------------------------------ helpers

async function withChallenge(ctx: any, s: Doc<'submissions'>) {
  const c = s.challengeId ? await ctx.db.get(s.challengeId) : null
  return { ...s, title: c?.title ?? s.freeformTitle ?? 'Mission' }
}

async function withAgentAndChallenge(ctx: any, s: Doc<'submissions'>) {
  const base = await withChallenge(ctx, s)
  const a = await ctx.db.get(s.agentId)
  return { ...base, agent: a ? publicAgent(a) : null }
}

/**
 * The one place a submission's status changes after creation. Keeps
 * agents.points in step whichever direction the status moves, so HQ can
 * overturn the classifier (or itself) without the board drifting.
 */
export async function applyReview(
  ctx: MutationCtx,
  s: Doc<'submissions'>,
  next: { status: 'approved' | 'rejected'; verifiedCount: number; reviewedBy: Id<'agents'> | 'auto'; reviewNote?: string },
) {
  const before = s.status === 'approved' ? s.verifiedCount ?? 0 : 0
  const after = next.status === 'approved' ? next.verifiedCount : 0
  const now = Date.now()
  await ctx.db.patch(s._id, {
    status: next.status,
    verifiedCount: next.status === 'approved' ? next.verifiedCount : undefined,
    reviewedBy: next.reviewedBy,
    reviewNote: next.reviewNote,
    reviewedAt: now,
    evidencePurgeAt: s.storageId ? now + PURGE_AFTER : undefined,
  })
  if (after !== before) {
    const agent = await ctx.db.get(s.agentId)
    if (agent) await ctx.db.patch(agent._id, { points: Math.max(0, agent.points + after - before) })
  }
}

// ------------------------------------------------- internal (classify, crons)

export const getForClassifier = internalQuery({
  args: { submissionId: v.id('submissions') },
  handler: async (ctx, { submissionId }) => {
    const s = await ctx.db.get(submissionId)
    if (!s) return null
    const c = s.challengeId ? await ctx.db.get(s.challengeId) : null
    return { submission: s, phrase: c?.phrase ?? DEFAULT_PHRASE, title: c?.title ?? s.freeformTitle ?? 'Mission' }
  },
})

export const recordVerdict = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    transcript: v.optional(v.string()),
    verdict: v.optional(
      v.object({
        saidPhrase: v.boolean(),
        gotResponse: v.boolean(),
        encounterCount: v.number(),
        confidence: v.number(),
        reasoning: v.string(),
        model: v.string(),
      }),
    ),
    decision: v.union(v.literal('approved'), v.literal('rejected'), v.literal('pending')),
    verifiedCount: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { submissionId, transcript, verdict, decision, verifiedCount, error }) => {
    const s = await ctx.db.get(submissionId)
    if (!s || s.status !== 'processing') return
    await ctx.db.patch(submissionId, { transcript, verdict, classifierError: error })
    if (decision === 'pending') {
      await ctx.db.patch(submissionId, { status: 'pending' })
      return
    }
    const fresh = (await ctx.db.get(submissionId))!
    await applyReview(ctx, fresh, {
      status: decision,
      verifiedCount: verifiedCount ?? 0,
      reviewedBy: 'auto',
      reviewNote: verdict?.reasoning,
    })
  },
})

export const purgeEvidence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query('submissions')
      .withIndex('by_purge', (q) => q.lt('evidencePurgeAt', Date.now()))
      .take(100)
    for (const s of due) {
      if (s.storageId) await ctx.storage.delete(s.storageId)
      await ctx.db.patch(s._id, { storageId: undefined, evidencePurgeAt: undefined })
    }
  },
})

/** Anything stuck in `processing` for over ten minutes goes to HQ instead of vanishing. */
export const rescueStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query('submissions')
      .withIndex('by_status', (q) => q.eq('status', 'processing').lt('createdAt', Date.now() - 10 * 60 * 1000))
      .take(50)
    for (const s of stuck) await ctx.db.patch(s._id, { status: 'pending', classifierError: s.classifierError ?? 'Classifier timed out' })
  },
})
