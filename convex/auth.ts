/**
 * Sign up, log in, password changes. Actions rather than mutations so the
 * PBKDF2 work never runs inside a transaction.
 */
import { action } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { hashPassword, needsRehash, newToken, sha256, verifyPassword } from './lib/crypto'
import { MIN_PASSWORD, handleProblem, normaliseHandle, passwordProblem } from './lib/handles'
import type { Doc } from './_generated/dataModel'
import { validUniversityId } from './agents'
import { isYearId } from './lib/years'

// A real hash of a throwaway password, verified against when the handle does not exist.
const DUMMY_HASH = 'pbkdf2$600000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000'

async function issueSession(ctx: any, agentId: Doc<'agents'>['_id']) {
  const token = newToken()
  await ctx.runMutation(internal.agents.createSession, { agentId, tokenHash: await sha256(token) })
  return token
}

export const signUp = action({
  args: { handle: v.string(), password: v.string(), universityId: v.string(), universityOther: v.optional(v.string()), year: v.optional(v.string()) },
  handler: async (ctx, { handle: raw, password, universityId, universityOther, year }): Promise<{ token: string }> => {
    const problem = handleProblem(raw)
    if (problem) throw new ConvexError(problem)
    if (!validUniversityId(universityId)) throw new ConvexError('Pick your university from the list.')
    if (year !== undefined && !isYearId(year)) throw new ConvexError('Pick your year from the list.')
    const handle = normaliseHandle(raw)
    const weak = passwordProblem(password, handle)
    if (weak) throw new ConvexError(weak)
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
      universityOther,
      year,
    })
    return { token: await issueSession(ctx, agentId) }
  },
})

export const logIn = action({
  args: { handle: v.string(), password: v.string() },
  handler: async (ctx, { handle: raw, password }): Promise<{ token: string }> => {
    const handle = normaliseHandle(raw)
    const lockedUntil = await ctx.runQuery(internal.agents.loginLock, { handle })
    if (lockedUntil) {
      const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000))
      throw new ConvexError(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
    }
    const agent = await ctx.runQuery(internal.agents.byHandle, { handle })
    // Same message for unknown handle and wrong password, and the same cost:
    // an unknown handle still burns a hash so timing does not reveal it.
    const ok = agent ? await verifyPassword(password, agent.passwordHash) : (await verifyPassword(password, DUMMY_HASH), false)
    await ctx.runMutation(internal.agents.recordLogin, { handle, ok })
    if (!ok || !agent) throw new ConvexError('Wrong username or password.')
    if (agent.status !== 'active') throw new ConvexError('This account has been retired from the programme.')
    if (needsRehash(agent.passwordHash)) {
      await ctx.runMutation(internal.agents.setPasswordHash, { agentId: agent._id, passwordHash: await hashPassword(password), actorId: agent._id, revokeSessions: false, silent: true })
    }
    return { token: await issueSession(ctx, agent._id) }
  },
})

export const changePassword = action({
  args: { token: v.string(), current: v.string(), next: v.string() },
  handler: async (ctx, { token, current, next }) => {
    const me = await ctx.runQuery(internal.authInternal.agentForToken, { token })
    if (!me) throw new ConvexError('Not signed in')
    if (!(await verifyPassword(current, me.passwordHash))) throw new ConvexError('Current password is wrong.')
    const weak = passwordProblem(next, me.handle)
    if (weak) throw new ConvexError(weak)
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
