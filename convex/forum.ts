/**
 * The forum: threads and flat replies, members only.
 *
 * Adults this time (freshers), so posts publish immediately. A slim triage
 * filter hides only what is clearly not wanted; reports go to HQ, and HQ can
 * hide, pin, lock. Nothing here is served to anyone who is not signed in.
 */
import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { agentFromToken, log, publicAgent, requireAgent, requireLead } from './agents'

export const MAX_POST_CHARS = 2000
const MAX_TITLE_CHARS = 100
const POSTS_PER_HOUR = 20
const HOUR = 60 * 60 * 1000

const category = v.union(v.literal('general'), v.literal('missions'), v.literal('intel'))

/** Slurs and nothing else: swearing is fine, this is a forum for students. */
const HIDE_PATTERNS = [/\bn[i1]gg(?:a|er)s?\b/i, /\bf[a@]gg?[o0]ts?\b/i, /\bretards?\b/i, /\btrann(?:y|ies)\b/i]

export function screen(body: string) {
  return HIDE_PATTERNS.some((p) => p.test(body))
}

export const threads = query({
  args: { token: v.optional(v.string()), category: v.optional(category) },
  handler: async (ctx, { token, category: cat }) => {
    if (!(await agentFromToken(ctx, token))) return null
    const pinned = await ctx.db.query('threads').withIndex('by_activity', (q) => q.eq('hidden', false).eq('pinned', true)).order('desc').take(10)
    const rest = await ctx.db.query('threads').withIndex('by_activity', (q) => q.eq('hidden', false).eq('pinned', false)).order('desc').take(100)
    const rows = [...pinned, ...rest].filter((t) => !cat || t.category === cat)
    return Promise.all(
      rows.map(async (t) => {
        const a = await ctx.db.get(t.authorId)
        return { ...t, author: a ? publicAgent(a) : null }
      }),
    )
  },
})

export const thread = query({
  args: { token: v.optional(v.string()), threadId: v.id('threads') },
  handler: async (ctx, { token, threadId }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    const t = await ctx.db.get(threadId)
    if (!t || (t.hidden && me.rank !== 'lead')) return null
    const posts = await ctx.db.query('posts').withIndex('by_thread', (q) => q.eq('threadId', threadId)).collect()
    const author = await ctx.db.get(t.authorId)
    const cache = new Map<string, ReturnType<typeof publicAgent> | null>()
    const withAuthors = []
    for (const p of posts) {
      if (p.hidden && me.rank !== 'lead' && p.authorId !== me._id) continue
      if (!cache.has(p.authorId)) {
        const a = await ctx.db.get(p.authorId)
        cache.set(p.authorId, a ? publicAgent(a) : null)
      }
      withAuthors.push({ ...p, author: cache.get(p.authorId) })
    }
    return { ...t, author: author ? publicAgent(author) : null, posts: withAuthors }
  },
})

export const createThread = mutation({
  args: { token: v.string(), title: v.string(), body: v.string(), category },
  handler: async (ctx, { token, title, body, category: cat }) => {
    const me = await requireAgent(ctx, token)
    const cleanTitle = title.trim().slice(0, MAX_TITLE_CHARS)
    const cleanBody = body.trim()
    if (!cleanTitle) throw new ConvexError('Give the thread a title')
    if (!cleanBody) throw new ConvexError('Say something')
    if (cleanBody.length > MAX_POST_CHARS) throw new ConvexError(`Keep it under ${MAX_POST_CHARS} characters`)
    await floodGuard(ctx, me._id)
    const hidden = screen(cleanTitle + ' ' + cleanBody)
    const now = Date.now()
    const threadId = await ctx.db.insert('threads', {
      title: cleanTitle,
      category: cat,
      authorId: me._id,
      pinned: false,
      locked: false,
      hidden,
      postCount: 1,
      lastPostAt: now,
      createdAt: now,
    })
    await ctx.db.insert('posts', { threadId, authorId: me._id, body: cleanBody, hidden, createdAt: now })
    return threadId
  },
})

export const reply = mutation({
  args: { token: v.string(), threadId: v.id('threads'), body: v.string() },
  handler: async (ctx, { token, threadId, body }) => {
    const me = await requireAgent(ctx, token)
    const t = await ctx.db.get(threadId)
    if (!t || t.hidden) throw new ConvexError('Thread not found')
    if (t.locked && me.rank !== 'lead') throw new ConvexError('This thread is locked')
    const clean = body.trim()
    if (!clean) throw new ConvexError('Say something')
    if (clean.length > MAX_POST_CHARS) throw new ConvexError(`Keep it under ${MAX_POST_CHARS} characters`)
    await floodGuard(ctx, me._id)
    const hidden = screen(clean)
    const now = Date.now()
    await ctx.db.insert('posts', { threadId, authorId: me._id, body: clean, hidden, createdAt: now })
    if (!hidden) await ctx.db.patch(threadId, { postCount: t.postCount + 1, lastPostAt: now })
  },
})

export const report = mutation({
  args: { token: v.string(), postId: v.id('posts'), reason: v.string() },
  handler: async (ctx, { token, postId, reason }) => {
    const me = await requireAgent(ctx, token)
    if (!(await ctx.db.get(postId))) throw new ConvexError('Post not found')
    await ctx.db.insert('reports', { reporterId: me._id, postId, reason: reason.trim().slice(0, 300), createdAt: Date.now() })
  },
})

// ---------------------------------------------------------------------- HQ

export const openReports = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const rows = await ctx.db.query('reports').withIndex('by_open', (q) => q.eq('resolvedAt', undefined)).order('desc').take(100)
    return Promise.all(
      rows.map(async (r) => {
        const post = await ctx.db.get(r.postId)
        const author = post ? await ctx.db.get(post.authorId) : null
        const reporter = await ctx.db.get(r.reporterId)
        return { ...r, post, author: author ? publicAgent(author) : null, reporter: reporter ? publicAgent(reporter) : null }
      }),
    )
  },
})

export const moderatePost = mutation({
  args: { token: v.string(), postId: v.id('posts'), hidden: v.boolean(), resolveReports: v.optional(v.boolean()) },
  handler: async (ctx, { token, postId, hidden, resolveReports }) => {
    const lead = await requireLead(ctx, token)
    const post = await ctx.db.get(postId)
    if (!post) throw new ConvexError('Post not found')
    await ctx.db.patch(postId, { hidden })
    if (resolveReports) {
      const open = await ctx.db.query('reports').withIndex('by_open', (q) => q.eq('resolvedAt', undefined)).collect()
      for (const r of open) if (r.postId === postId) await ctx.db.patch(r._id, { resolvedAt: Date.now() })
    }
    await log(ctx, lead._id, hidden ? 'post-hide' : 'post-unhide', postId)
  },
})

export const moderateThread = mutation({
  args: { token: v.string(), threadId: v.id('threads'), pinned: v.optional(v.boolean()), locked: v.optional(v.boolean()), hidden: v.optional(v.boolean()) },
  handler: async (ctx, { token, threadId, ...patch }) => {
    const lead = await requireLead(ctx, token)
    const defined = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined))
    await ctx.db.patch(threadId, defined)
    await log(ctx, lead._id, 'thread-moderate', threadId, defined)
  },
})

async function floodGuard(ctx: any, agentId: any) {
  // by_thread is the only index on posts; a per-hour count across threads is
  // a filter over recent rows and cheap at this scale.
  const since = Date.now() - HOUR
  const recent = await ctx.db
    .query('posts')
    .filter((q: any) => q.and(q.eq(q.field('authorId'), agentId), q.gt(q.field('createdAt'), since)))
    .collect()
  if (recent.length >= POSTS_PER_HOUR) throw new ConvexError('Slow down, agent. Try again in a bit.')
}
