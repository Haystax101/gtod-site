import { internalQuery } from './_generated/server'
import { v } from 'convex/values'
import { agentFromToken } from './agents'

/** Full agent row (including the hash) for actions that must verify a password. */
export const agentForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => agentFromToken(ctx, token),
})
