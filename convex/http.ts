import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

const http = httpRouter()

// Stripe → POST https://<deployment>.convex.site/stripe/webhook
http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get('stripe-signature')
    if (!signature) return new Response('Missing signature', { status: 400 })
    const payload = await req.text()
    try {
      await ctx.runAction(internal.billing.fulfill, { payload, signature })
      return new Response(null, { status: 200 })
    } catch (err: any) {
      console.error('Stripe webhook rejected', err?.message)
      return new Response('Webhook error', { status: 400 })
    }
  }),
})

export default http
