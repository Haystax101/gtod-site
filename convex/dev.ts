// Developer smoke test: creates a throwaway user + conversation and runs the
// full send → generate pipeline without needing a signed-in browser.
//   npx convex run dev:smokeTest
//   npx convex run dev:smokeResult '{"conversationId": "..."}'
//   npx convex run dev:smokeCleanup
import { internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'
import { TIERS } from './tiers'

const SMOKE_CLERK_ID = 'smoke-test-user'

export const smokeTest = internalMutation({
  args: { plan: v.optional(v.union(v.literal('flash'), v.literal('pro'))), prompt: v.optional(v.string()) },
  handler: async (ctx, { plan = 'flash', prompt = 'How long should my CV be, and what goes at the top?' }) => {
    let user = await ctx.db.query('users').withIndex('by_clerkId', (q) => q.eq('clerkId', SMOKE_CLERK_ID)).unique()
    if (!user) {
      const id = await ctx.db.insert('users', { clerkId: SMOKE_CLERK_ID, name: 'Smoke Test', plan, createdAt: Date.now() })
      user = (await ctx.db.get(id))!
    } else if (user.plan !== plan) {
      await ctx.db.patch(user._id, { plan })
    }
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', { userId: user._id, title: 'Smoke test', createdAt: now, updatedAt: now })
    await ctx.db.insert('messages', { conversationId, userId: user._id, role: 'user', content: prompt, status: 'done', createdAt: now })
    const assistantId = await ctx.db.insert('messages', {
      conversationId, userId: user._id, role: 'assistant', content: '', status: 'streaming',
      tier: plan, model: TIERS[plan].model, createdAt: now + 1,
    })
    await ctx.scheduler.runAfter(0, internal.chat.generate, { assistantId })
    return { conversationId, assistantId }
  },
})

export const smokeResult = internalQuery({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, { conversationId }) => {
    const msgs = await ctx.db.query('messages').withIndex('by_conversation', (q) => q.eq('conversationId', conversationId)).collect()
    const user = await ctx.db.query('users').withIndex('by_clerkId', (q) => q.eq('clerkId', SMOKE_CLERK_ID)).unique()
    const usage = user ? await ctx.db.query('usage').withIndex('by_user_month', (q) => q.eq('userId', user._id)).collect() : []
    return { messages: msgs.map((m) => ({ role: m.role, status: m.status, tokens: [m.inputTokens ?? null, m.outputTokens ?? null], content: m.content.slice(0, 600) })), usage }
  },
})

export const smokeCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.query('users').withIndex('by_clerkId', (q) => q.eq('clerkId', SMOKE_CLERK_ID)).unique()
    if (!user) return 'nothing to clean'
    const convos = await ctx.db.query('conversations').withIndex('by_user', (q) => q.eq('userId', user._id)).collect()
    for (const c of convos) {
      const msgs = await ctx.db.query('messages').withIndex('by_conversation', (q) => q.eq('conversationId', c._id)).collect()
      for (const m of msgs) await ctx.db.delete(m._id)
      await ctx.db.delete(c._id)
    }
    const usage = await ctx.db.query('usage').withIndex('by_user_month', (q) => q.eq('userId', user._id)).collect()
    for (const u of usage) await ctx.db.delete(u._id)
    await ctx.db.delete(user._id)
    return `removed ${convos.length} conversations`
  },
})
