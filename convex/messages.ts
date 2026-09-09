import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'
import { currentUser } from './users'
import { costMicros, monthKey } from './tiers'

export const list = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, { conversationId }) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const convo = await ctx.db.get(conversationId)
    if (!convo || convo.userId !== user._id) return []
    return ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect()
  },
})

export const append = internalMutation({
  args: { id: v.id('messages'), content: v.string() },
  handler: async (ctx, { id, content }) => {
    await ctx.db.patch(id, { content })
  },
})

export const finish = internalMutation({
  args: {
    id: v.id('messages'),
    content: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, { id, content, inputTokens, outputTokens }) => {
    const msg = await ctx.db.get(id)
    if (!msg) return
    await ctx.db.patch(id, { content, status: 'done', inputTokens, outputTokens })
    await ctx.db.patch(msg.conversationId, { updatedAt: Date.now() })
    const tier = msg.tier ?? 'flash'
    const cost = costMicros(tier, inputTokens, outputTokens)
    const month = monthKey()
    const row = await ctx.db
      .query('usage')
      .withIndex('by_user_month', (q) => q.eq('userId', msg.userId).eq('month', month))
      .unique()
    if (row) {
      await ctx.db.patch(row._id, {
        messages: row.messages + 1,
        inputTokens: row.inputTokens + inputTokens,
        outputTokens: row.outputTokens + outputTokens,
        costMicros: row.costMicros + cost,
      })
    } else {
      await ctx.db.insert('usage', { userId: msg.userId, month, messages: 1, inputTokens, outputTokens, costMicros: cost })
    }
  },
})

export const fail = internalMutation({
  args: { id: v.id('messages'), error: v.string() },
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { status: 'error', content: error })
  },
})
