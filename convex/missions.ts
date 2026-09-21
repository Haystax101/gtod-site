/**
 * Missions (the challenge list) and submissions (the stories agents write
 * about doing them).
 *
 * Flow: the agent picks a mission and writes up what happened. The row lands
 * as `pending` and stays there until HQ reads it and decides whether it is
 * worth a point. Nothing approves itself; there is no classifier any more.
 * Approved stories become public field reports on the brief.
 */
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { agentFromToken, log, publicAgent, requireAgent, requireLead } from './agents'
import { commentCount, isPublished, reactionSummary } from './stories'

export const DEFAULT_PHRASE = 'You here for uni then?'
export const MIN_STORY_CHARS = 80
export const MAX_STORY_CHARS = 4000
const MAX_POINTS = 50
const SUBMISSIONS_PER_HOUR = 6
const HOUR = 60 * 60 * 1000
const PURGE_AFTER = 30 * 24 * HOUR

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

const visibility = v.union(v.literal('public'), v.literal('private'))

export const submit = mutation({
  args: {
    token: v.string(),
    challengeId: v.optional(v.id('challenges')),
    freeformTitle: v.optional(v.string()),
    story: v.string(),
    visibility: v.optional(visibility),
  },
  handler: async (ctx, args) => {
    const me = await requireAgent(ctx, args.token)

    if (!args.challengeId && !args.freeformTitle?.trim()) throw new ConvexError('Pick a mission or name your own.')
    const story = args.story.trim().slice(0, MAX_STORY_CHARS)
    if (story.length < MIN_STORY_CHARS) {
      throw new ConvexError(`Give us the whole story: at least ${MIN_STORY_CHARS} characters. Who did you ask, and what happened?`)
    }

    const recent = await ctx.db
      .query('submissions')
      .withIndex('by_agent', (q) => q.eq('agentId', me._id).gt('createdAt', Date.now() - HOUR))
      .collect()
    if (recent.length >= SUBMISSIONS_PER_HOUR) throw new ConvexError('Slow down, agent. Try again in a bit.')
    if (recent.some((s) => s.story === story)) throw new ConvexError('You already filed that one.')

    return ctx.db.insert('submissions', {
      agentId: me._id,
      challengeId: args.challengeId,
      freeformTitle: args.freeformTitle?.trim().slice(0, 80) || undefined,
      story,
      visibility: args.visibility ?? 'public',
      status: 'pending',
      createdAt: Date.now(),
    })
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

/**
 * Public or private, the author's call, changeable at any time. Going private
 * pulls an approved story out of the feed and off the profile at once; the
 * points it earned stay, because HQ judged the story, not its audience.
 */
export const setVisibility = mutation({
  args: { token: v.string(), submissionId: v.id('submissions'), visibility },
  handler: async (ctx, { token, submissionId, visibility: next }) => {
    const me = await requireAgent(ctx, token)
    const s = await ctx.db.get(submissionId)
    if (!s) throw new ConvexError('No such report')
    if (s.agentId !== me._id) throw new ConvexError('Not yours')
    await ctx.db.patch(submissionId, { visibility: next })
  },
})

/**
 * Playback for the recordings left over from the voice-evidence era. Only the
 * owner and HQ get a URL, and only until the purge cron deletes the file.
 */
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

/**
 * The community feed: approved stories their authors left public, newest
 * first, each with its reaction tallies and comment count.
 */
export const feed = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    const rows = await ctx.db.query('submissions').withIndex('by_status', (q) => q.eq('status', 'approved')).order('desc').take(60)
    const published = rows.filter(isPublished).slice(0, 25)
    return Promise.all(
      published.map(async (s) => {
        const a = await ctx.db.get(s.agentId)
        const c = s.challengeId ? await ctx.db.get(s.challengeId) : null
        return {
          _id: s._id,
          agent: a ? publicAgent(a) : null,
          title: c?.title ?? s.freeformTitle ?? 'Mission',
          story: s.story ?? null,
          points: s.verifiedCount ?? 0,
          reviewedAt: s.reviewedAt ?? s.createdAt,
          mine: s.agentId === me._id,
          reactions: await reactionSummary(ctx, s._id, me._id),
          comments: await commentCount(ctx, s._id),
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
    points: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, { token, submissionId, status, points, reviewNote }) => {
    const lead = await requireLead(ctx, token)
    const s = await ctx.db.get(submissionId)
    if (!s) throw new ConvexError('No such submission')
    const awarded = Math.max(0, Math.min(MAX_POINTS, Math.round(points ?? 1)))
    await applyReview(ctx, s, {
      status,
      points: status === 'approved' ? awarded : 0,
      reviewedBy: lead._id,
      reviewNote: reviewNote?.trim().slice(0, 300) || undefined,
    })
    await log(ctx, lead._id, `submission-${status}`, submissionId, { agentId: s.agentId, points: awarded })
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
 * The one place a submission's status changes after it is filed. Keeps
 * agents.points in step whichever direction the status moves, so HQ can
 * change its mind without the board drifting.
 */
export async function applyReview(
  ctx: MutationCtx,
  s: Doc<'submissions'>,
  next: { status: 'approved' | 'rejected'; points: number; reviewedBy: Id<'agents'>; reviewNote?: string },
) {
  const before = s.status === 'approved' ? s.verifiedCount ?? 0 : 0
  const after = next.status === 'approved' ? next.points : 0
  const now = Date.now()
  await ctx.db.patch(s._id, {
    status: next.status,
    verifiedCount: next.status === 'approved' ? next.points : undefined,
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

// ------------------------------------------------------------ internal (crons)

/** Legacy audio: deleted 30 days after review, and after 30 days regardless. */
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

/**
 * Nothing enters `processing` any more, but a row left there when the
 * classifier was retired must not sit invisible: move it to HQ's queue.
 */
export const rescueStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query('submissions')
      .withIndex('by_status', (q) => q.eq('status', 'processing').lt('createdAt', Date.now() - 10 * 60 * 1000))
      .take(50)
    for (const s of stuck) await ctx.db.patch(s._id, { status: 'pending' })
  },
})
