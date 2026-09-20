/**
 * Donations. The button in the app is a Stripe Payment Link with
 * client_reference_id set to the agent's id; Stripe calls the webhook in
 * http.ts, and a completed Checkout session earns the Loyal badge.
 */
import { internalAction, internalMutation } from './_generated/server'
import { v } from 'convex/values'
import Stripe from 'stripe'
import { internal } from './_generated/api'

export const fulfill = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, { payload, signature }) => {
    const secret = process.env.STRIPE_SECRET_KEY
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret || !whSecret) throw new Error('Stripe not configured')
    const stripe = new Stripe(secret)
    const event = await stripe.webhooks.constructEventAsync(payload, signature, whSecret)
    if (event.type !== 'checkout.session.completed') return
    const session = event.data.object as Stripe.Checkout.Session
    if (session.payment_status !== 'paid') return
    await ctx.runMutation(internal.billing.recordDonation, {
      stripeSessionId: session.id,
      agentId: session.client_reference_id ?? undefined,
      amountPence: session.amount_total ?? 0,
      currency: session.currency ?? 'gbp',
      customerId: typeof session.customer === 'string' ? session.customer : undefined,
    })
  },
})

export const recordDonation = internalMutation({
  args: {
    stripeSessionId: v.string(),
    agentId: v.optional(v.string()),
    amountPence: v.number(),
    currency: v.string(),
    customerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dup = await ctx.db.query('donations').withIndex('by_stripeSessionId', (q) => q.eq('stripeSessionId', args.stripeSessionId)).unique()
    if (dup) return
    const agentId = args.agentId ? ctx.db.normalizeId('agents', args.agentId) : null
    const agent = agentId ? await ctx.db.get(agentId) : null
    await ctx.db.insert('donations', {
      agentId: agent?._id,
      stripeSessionId: args.stripeSessionId,
      amountPence: args.amountPence,
      currency: args.currency,
      createdAt: Date.now(),
    })
    if (agent) await ctx.db.patch(agent._id, { loyal: true, stripeCustomerId: args.customerId ?? agent.stripeCustomerId })
  },
})
