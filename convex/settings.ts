/** Public, non-secret configuration the app needs at runtime. */
import { query } from './_generated/server'
import { classifierConfigured } from './classify'

export const get = query({
  args: {},
  handler: async () => ({
    donateUrl: process.env.STRIPE_PAYMENT_LINK ?? null,
    classifierEnabled: classifierConfigured(),
  }),
})
