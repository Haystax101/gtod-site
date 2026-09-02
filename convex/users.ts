import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { TIERS, monthKey, startOfDay } from './tiers'

export async function currentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null
  return ctx.db.query('users').withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject)).unique()
}

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await currentUser(ctx)
  if (!user) throw new ConvexError('Not signed in')
  return user
}

// Called once after sign-in so the Clerk identity has a users row.
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Not signed in')
    const existing = await ctx.db.query('users').withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject)).unique()
    if (existing) {
      if (identity.email !== existing.email || identity.name !== existing.name) {
        await ctx.db.patch(existing._id, { email: identity.email, name: identity.name })
      }
      return existing._id
    }
    return ctx.db.insert('users', {
      clerkId: identity.subject,
      email: identity.email,
      name: identity.name,
      plan: 'flash',
      createdAt: Date.now(),
    })
  },
})

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return null
    const tier = TIERS[user.plan]
    const usage = await ctx.db
      .query('usage')
      .withIndex('by_user_month', (q) => q.eq('userId', user._id).eq('month', monthKey()))
      .unique()
    const today = await ctx.db
      .query('messages')
      .withIndex('by_user', (q) => q.eq('userId', user._id).gte('createdAt', startOfDay()))
      .filter((q) => q.eq(q.field('role'), 'user'))
      .collect()
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      currentPeriodEnd: user.currentPeriodEnd,
      hasBilling: Boolean(user.stripeCustomerId),
      limits: {
        label: tier.label,
        model: tier.model,
        dailyMessages: tier.dailyMessages,
        usedToday: today.length,
        monthlyCostMicros: tier.monthlyCostMicros,
        usedCostMicros: usage?.costMicros ?? 0,
        messagesThisMonth: usage?.messages ?? 0,
      },
    }
  },
})

export const setSubscription = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.string(),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', args.stripeCustomerId))
      .unique()
    if (!user) {
      console.warn('Stripe event for unknown customer', args.stripeCustomerId)
      return
    }
    const active = args.status === 'active' || args.status === 'trialing' || args.status === 'past_due'
    await ctx.db.patch(user._id, {
      plan: active ? 'pro' : 'flash',
      stripeSubscriptionId: args.stripeSubscriptionId,
      subscriptionStatus: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
    })
  },
})

export const setStripeCustomer = internalMutation({
  args: { userId: v.id('users'), stripeCustomerId: v.string() },
  handler: async (ctx, { userId, stripeCustomerId }) => {
    await ctx.db.patch(userId, { stripeCustomerId })
  },
})

export const getForBilling = internalMutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    return { _id: user._id, email: user.email, name: user.name, stripeCustomerId: user.stripeCustomerId }
  },
})
