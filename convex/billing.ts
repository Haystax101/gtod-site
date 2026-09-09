'use node'
import Stripe from 'stripe'
import { action, internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new ConvexError('Billing is not configured yet')
  return new Stripe(key)
}
const siteUrl = () => (process.env.SITE_URL ?? 'https://getthereoneday.com').replace(/\/$/, '')

// Start a Stripe Checkout for the Pro subscription; the client redirects to the returned URL.
export const createCheckout = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const priceId = process.env.STRIPE_PRICE_ID
    if (!priceId) throw new ConvexError('Billing is not configured yet')
    const s = stripe()
    const user = await ctx.runMutation(internal.users.getForBilling, {})
    let customerId = user.stripeCustomerId
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email,
        name: user.name,
        metadata: { convexUserId: user._id },
      })
      customerId = customer.id
      await ctx.runMutation(internal.users.setStripeCustomer, { userId: user._id, stripeCustomerId: customerId })
    }
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl()}/charge?upgraded=1`,
      cancel_url: `${siteUrl()}/charge`,
      allow_promotion_codes: true,
      client_reference_id: user._id,
    })
    if (!session.url) throw new ConvexError('Stripe did not return a checkout URL')
    return session.url
  },
})

// Stripe's hosted portal for cancelling / updating card.
export const createPortal = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const s = stripe()
    const user = await ctx.runMutation(internal.users.getForBilling, {})
    if (!user.stripeCustomerId) throw new ConvexError('No billing account yet')
    const session = await s.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${siteUrl()}/charge`,
    })
    return session.url
  },
})

// Verifies and applies a Stripe webhook. Called from convex/http.ts.
export const fulfill = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, { payload, signature }) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new ConvexError('STRIPE_WEBHOOK_SECRET missing')
    const s = stripe()
    const event = await s.webhooks.constructEventAsync(payload, signature, secret)

    const applySubscription = async (sub: Stripe.Subscription) => {
      const item = sub.items.data[0]
      await ctx.runMutation(internal.users.setSubscription, {
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        stripeSubscriptionId: sub.id,
        status: sub.status,
        currentPeriodEnd: item?.current_period_end ? item.current_period_end * 1000 : undefined,
      })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await s.subscriptions.retrieve(
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id,
          )
          await applySubscription(sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object)
        break
      default:
        break
    }
    return { received: true, type: event.type }
  },
})
