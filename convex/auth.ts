/**
 * Sign up, log in, password changes. Actions rather than mutations so the
 * PBKDF2 work never runs inside a transaction.
 */
import { action } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { hashPassword, newToken, sha256, verifyPassword } from './lib/crypto'
import { MIN_PASSWORD, handleProblem, normaliseHandle } from './lib/handles'
import type { Doc } from './_generated/dataModel'
import { validUniversityId } from './agents'

async function issueSession(ctx: any, agentId: Doc<'agents'>['_id']) {
  const token = newToken()
  await ctx.runMutation(internal.agents.createSession, { agentId, tokenHash: await sha256(token) })
  return token
}

export const signUp = action({
  args: { handle: v.string(), password: v.string(), universityId: v.string() },
  handler: async (ctx, { handle: raw, password, universityId }): Promise<{ token: string }> => {
    const problem = handleProblem(raw)
    if (problem) throw new ConvexError(problem)
    if (!validUniversityId(universityId)) throw new ConvexError('Pick your university from the list.')
    if (password.length < MIN_PASSWORD) throw new ConvexError(`Password needs at least ${MIN_PASSWORD} characters.`)
    const handle = normaliseHandle(raw)
    const displayHandle = raw.trim().replace(/^@+/, '')
    const existing = await ctx.runQuery(internal.agents.byHandle, { handle })
    if (existing) {
      throw new ConvexError(
        existing.status === 'removed'
          ? 'That username has been retired from the programme.'
          : 'That TikTok username is already enrolled. Log in instead.',
      )
    }
    const leadHandle = normaliseHandle(process.env.LEAD_HANDLE ?? 'george')
    const agentId = await ctx.runMutation(internal.agents.create, {
      handle,
      displayHandle,
      passwordHash: await hashPassword(password),
      // First sign-up with the configured lead handle becomes Lead Operative.
      rank: handle === leadHandle ? 'lead' : 'junior',
      universityId,
    })
    return { token: await issueSession(ctx, agentId) }
  },
})

export const logIn = action({
  args: { handle: v.string(), password: v.string() },
  handler: async (ctx, { handle: raw, password }): Promise<{ token: string }> => {
    const handle = normaliseHandle(raw)
    const agent = await ctx.runQuery(internal.agents.byHandle, { handle })
    // Same message for unknown handle and wrong password.
    const bad = new ConvexError('Wrong username or password.')
    if (!agent) throw bad
    if (agent.status !== 'active') throw new ConvexError('This account has been retired from the programme.')
    if (!(await verifyPassword(password, agent.passwordHash))) throw bad
    return { token: await issueSession(ctx, agent._id) }
  },
})

export const changePassword = action({
  args: { token: v.string(), current: v.string(), next: v.string() },
  handler: async (ctx, { token, current, next }) => {
    const me = await ctx.runQuery(internal.authInternal.agentForToken, { token })
    if (!me) throw new ConvexError('Not signed in')
    if (!(await verifyPassword(current, me.passwordHash))) throw new ConvexError('Current password is wrong.')
    if (next.length < MIN_PASSWORD) throw new ConvexError(`Password needs at least ${MIN_PASSWORD} characters.`)
    await ctx.runMutation(internal.agents.setPasswordHash, {
      agentId: me._id,
      passwordHash: await hashPassword(next),
      actorId: me._id,
      revokeSessions: false,
    })
  },
})

/** HQ resets a password for someone locked out (they have no email to recover with). */
export const resetPassword = action({
  args: { token: v.string(), agentId: v.id('agents'), next: v.string() },
  handler: async (ctx, { token, agentId, next }) => {
    const lead = await ctx.runQuery(internal.authInternal.agentForToken, { token })
    if (!lead || lead.rank !== 'lead') throw new ConvexError('Lead Operative clearance required')
    if (next.length < MIN_PASSWORD) throw new ConvexError(`Password needs at least ${MIN_PASSWORD} characters.`)
    await ctx.runMutation(internal.agents.setPasswordHash, {
      agentId,
      passwordHash: await hashPassword(next),
      actorId: lead._id,
      revokeSessions: true,
    })
  },
})
