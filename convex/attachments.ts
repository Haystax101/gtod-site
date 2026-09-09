import { internalMutation, mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { requireUser, currentUser } from './users'

export const MAX_CHARS = 24_000
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

// Text is extracted in the browser; we never receive the file itself.
export const create = mutation({
  args: { name: v.string(), kind: v.string(), text: v.string() },
  handler: async (ctx, { name, kind, text }) => {
    const user = await requireUser(ctx)
    const clean = text.replace(/\u0000/g, '').trim().slice(0, MAX_CHARS)
    if (clean.length < 20) throw new ConvexError("Couldn't read any text from that file")
    return ctx.db.insert('attachments', {
      userId: user._id,
      name: name.slice(0, 120),
      kind,
      text: clean,
      chars: clean.length,
      createdAt: Date.now(),
    })
  },
})

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const rows = await ctx.db
      .query('attachments')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(50)
    return rows.map(({ text: _t, ...rest }) => rest)
  },
})

export const remove = mutation({
  args: { id: v.id('attachments') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const a = await ctx.db.get(id)
    if (!a || a.userId !== user._id) throw new ConvexError('Not found')
    await ctx.db.delete(id)
  },
})

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS
    const old = await ctx.db
      .query('attachments')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    await Promise.all(old.map((a) => ctx.db.delete(a._id)))
    return old.length
  },
})
