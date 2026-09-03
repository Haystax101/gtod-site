import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { requireUser, currentUser } from './users'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return []
    return ctx.db
      .query('conversations')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(100)
  },
})

export const rename = mutation({
  args: { id: v.id('conversations'), title: v.string() },
  handler: async (ctx, { id, title }) => {
    const user = await requireUser(ctx)
    const convo = await ctx.db.get(id)
    if (!convo || convo.userId !== user._id) throw new ConvexError('Not found')
    await ctx.db.patch(id, { title: title.trim().slice(0, 80) || 'Untitled' })
  },
})

export const remove = mutation({
  args: { id: v.id('conversations') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const convo = await ctx.db.get(id)
    if (!convo || convo.userId !== user._id) throw new ConvexError('Not found')
    const msgs = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', id))
      .collect()
    await Promise.all(msgs.map((m) => ctx.db.delete(m._id)))
    await ctx.db.delete(id)
  },
})
