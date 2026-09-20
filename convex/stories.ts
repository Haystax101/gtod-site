/**
 * Published stories: the social layer on top of an approved, public field
 * report. Comments, three reactions, and reporting.
 *
 * A story is readable by other agents only when HQ has approved it AND the
 * author left it public. Everything here goes through `readableStory`, so a
 * private or unapproved story cannot be commented on, reacted to or read by
 * anyone but its author and HQ.
 */
import { mutation, query, type QueryCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { agentFromToken, log, publicAgent, requireAgent, requireLead } from './agents'
import { screen } from './forum'

export const MAX_COMMENT_CHARS = 1000
const COMMENTS_PER_HOUR = 30
const HOUR = 60 * 60 * 1000

export const reactionKind = v.union(v.literal('salute'), v.literal('laugh'), v.literal('heart'))
export const REACTIONS = [
  { kind: 'salute', emoji: '🫡' },
  { kind: 'laugh', emoji: '😂' },
  { kind: 'heart', emoji: '❤️' },
] as const

/** Public when HQ approved it and the author did not mark it private. */
export function isPublished(s: Doc<'submissions'>) {
  return s.status === 'approved' && (s.visibility ?? 'public') === 'public'
}

/**
 * The story if this viewer may see it: published, or their own, or HQ's.
 * Everything public in this module funnels through here.
 */
async function readableStory(ctx: QueryCtx, viewer: Doc<'agents'>, submissionId: Id<'submissions'>) {
  const s = await ctx.db.get(submissionId)
  if (!s) return null
  if (isPublished(s) || s.agentId === viewer._id || viewer.rank === 'lead') return s
  return null
}

/** Reaction tallies and this viewer's own taps, for one story. */
export async function reactionSummary(ctx: QueryCtx, submissionId: Id<'submissions'>, viewerId: Id<'agents'>) {
  const rows = await ctx.db.query('storyReactions').withIndex('by_story', (q) => q.eq('submissionId', submissionId)).collect()
  return REACTIONS.map(({ kind, emoji }) => ({
    kind,
    emoji,
    count: rows.filter((r) => r.kind === kind).length,
    mine: rows.some((r) => r.kind === kind && r.agentId === viewerId),
  }))
}

/** Visible comments on a story: everyone's, minus anything HQ hid. */
export async function commentCount(ctx: QueryCtx, submissionId: Id<'submissions'>) {
  const rows = await ctx.db.query('storyComments').withIndex('by_story', (q) => q.eq('submissionId', submissionId)).collect()
  return rows.filter((c) => !c.hidden).length
}

// ------------------------------------------------------------------ reading

/** One story in full, with its comments. The story page. */
export const get = query({
  args: { token: v.optional(v.string()), submissionId: v.id('submissions') },
  handler: async (ctx, { token, submissionId }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    const s = await readableStory(ctx, me, submissionId)
    if (!s) return null
    const author = await ctx.db.get(s.agentId)
    const challenge = s.challengeId ? await ctx.db.get(s.challengeId) : null
    const rows = await ctx.db.query('storyComments').withIndex('by_story', (q) => q.eq('submissionId', submissionId)).collect()
    const cache = new Map<string, ReturnType<typeof publicAgent> | null>()
    const comments = []
    for (const c of rows) {
      // A hidden comment stays visible to its author and to HQ, as in the forum.
      if (c.hidden && me.rank !== 'lead' && c.authorId !== me._id) continue
      if (!cache.has(c.authorId)) {
        const a = await ctx.db.get(c.authorId)
        cache.set(c.authorId, a ? publicAgent(a) : null)
      }
      comments.push({ ...c, author: cache.get(c.authorId) })
    }
    return {
      _id: s._id,
      agent: author ? publicAgent(author) : null,
      title: challenge?.title ?? s.freeformTitle ?? 'Mission',
      story: s.story ?? null,
      points: s.verifiedCount ?? 0,
      reviewedAt: s.reviewedAt ?? s.createdAt,
      published: isPublished(s),
      mine: s.agentId === me._id,
      reactions: await reactionSummary(ctx, s._id, me._id),
      comments,
    }
  },
})

// ----------------------------------------------------------------- reactions

export const react = mutation({
  args: { token: v.string(), submissionId: v.id('submissions'), kind: reactionKind },
  handler: async (ctx, { token, submissionId, kind }) => {
    const me = await requireAgent(ctx, token)
    const s = await readableStory(ctx, me, submissionId)
    if (!s || !isPublished(s)) throw new ConvexError('That story is not published.')
    const existing = await ctx.db
      .query('storyReactions')
      .withIndex('by_story_agent', (q) => q.eq('submissionId', submissionId).eq('agentId', me._id).eq('kind', kind))
      .unique()
    if (existing) {
      await ctx.db.delete(existing._id)
      return false
    }
    await ctx.db.insert('storyReactions', { submissionId, agentId: me._id, kind, createdAt: Date.now() })
    return true
  },
})

// ------------------------------------------------------------------ comments

export const comment = mutation({
  args: { token: v.string(), submissionId: v.id('submissions'), body: v.string() },
  handler: async (ctx, { token, submissionId, body }) => {
    const me = await requireAgent(ctx, token)
    const s = await readableStory(ctx, me, submissionId)
    if (!s || !isPublished(s)) throw new ConvexError('That story is not published.')
    const clean = body.trim()
    if (!clean) throw new ConvexError('Say something')
    if (clean.length > MAX_COMMENT_CHARS) throw new ConvexError(`Keep it under ${MAX_COMMENT_CHARS} characters`)
    const recent = await ctx.db
      .query('storyComments')
      .withIndex('by_author', (q) => q.eq('authorId', me._id).gt('createdAt', Date.now() - HOUR))
      .collect()
    if (recent.length >= COMMENTS_PER_HOUR) throw new ConvexError('Slow down, agent. Try again in a bit.')
    return ctx.db.insert('storyComments', {
      submissionId,
      authorId: me._id,
      body: clean,
      hidden: screen(clean),
      createdAt: Date.now(),
    })
  },
})

/** Delete your own comment. HQ hides rather than deletes, via moderateComment. */
export const deleteComment = mutation({
  args: { token: v.string(), commentId: v.id('storyComments') },
  handler: async (ctx, { token, commentId }) => {
    const me = await requireAgent(ctx, token)
    const c = await ctx.db.get(commentId)
    if (!c) return
    if (c.authorId !== me._id) throw new ConvexError('Not yours')
    await ctx.db.delete(commentId)
  },
})

// ------------------------------------------------------------------- reports

export const report = mutation({
  args: {
    token: v.string(),
    reason: v.string(),
    submissionId: v.optional(v.id('submissions')),
    commentId: v.optional(v.id('storyComments')),
  },
  handler: async (ctx, { token, reason, submissionId, commentId }) => {
    const me = await requireAgent(ctx, token)
    if (Number(Boolean(submissionId)) + Number(Boolean(commentId)) !== 1) throw new ConvexError('Report one thing at a time.')
    if (submissionId) {
      const s = await ctx.db.get(submissionId)
      if (!s || !isPublished(s)) throw new ConvexError('Story not found')
    }
    if (commentId && !(await ctx.db.get(commentId))) throw new ConvexError('Comment not found')
    await ctx.db.insert('reports', {
      reporterId: me._id,
      kind: submissionId ? 'story' : 'comment',
      submissionId,
      commentId,
      reason: reason.trim().slice(0, 300),
      createdAt: Date.now(),
    })
  },
})

// ------------------------------------------------------------------------ HQ

export const moderateComment = mutation({
  args: { token: v.string(), commentId: v.id('storyComments'), hidden: v.boolean(), resolveReports: v.optional(v.boolean()) },
  handler: async (ctx, { token, commentId, hidden, resolveReports }) => {
    const lead = await requireLead(ctx, token)
    const c = await ctx.db.get(commentId)
    if (!c) throw new ConvexError('Comment not found')
    await ctx.db.patch(commentId, { hidden })
    if (resolveReports) {
      const open = await ctx.db.query('reports').withIndex('by_open', (q) => q.eq('resolvedAt', undefined)).collect()
      for (const r of open) if (r.commentId === commentId) await ctx.db.patch(r._id, { resolvedAt: Date.now() })
    }
    await log(ctx, lead._id, hidden ? 'comment-hide' : 'comment-unhide', commentId)
  },
})
