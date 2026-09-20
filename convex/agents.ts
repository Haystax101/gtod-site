/**
 * Agents: who is in, what rank they hold, and the session helpers every other
 * module uses to find out who is calling.
 *
 * There is no third-party auth. A caller proves who they are with a bearer
 * token issued by auth.ts and passed as the `token` arg on every function.
 */
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { sha256 } from './lib/crypto'
import { rank } from './schema'
import { NOT_AT_UNI, OTHER_UNI, universityById } from './lib/universities'
import { sendWelcome } from './directLine'

export const SESSION_DAYS = 90
const DAY = 24 * 60 * 60 * 1000

export const RANK_LABEL: Record<Doc<'agents'>['rank'], string> = {
  junior: 'Junior Agent',
  senior: 'Senior Agent',
  advanced: 'Advanced Operative',
  lead: 'Lead Operative',
}

// ------------------------------------------------------------------ helpers

type Ctx = QueryCtx | MutationCtx

/** The agent behind a token, or null. Never throws: pages use it to decide what to show. */
export async function agentFromToken(ctx: Ctx, token: string | undefined | null) {
  if (!token) return null
  const tokenHash = await sha256(token)
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .unique()
  if (!session || session.expiresAt < Date.now()) return null
  const agent = await ctx.db.get(session.agentId)
  if (!agent || agent.status !== 'active') return null
  return agent
}

export async function requireAgent(ctx: Ctx, token: string | undefined | null) {
  const agent = await agentFromToken(ctx, token)
  if (!agent) throw new ConvexError('Not signed in')
  return agent
}

export async function requireLead(ctx: Ctx, token: string | undefined | null) {
  const agent = await requireAgent(ctx, token)
  if (agent.rank !== 'lead') throw new ConvexError('Lead Operative clearance required')
  return agent
}

/** What other agents may see of one another. Never the hash, never the Stripe id. */
export function publicAgent(a: Doc<'agents'>) {
  return {
    _id: a._id,
    handle: a.handle,
    displayHandle: a.displayHandle,
    rank: a.rank,
    rankLabel: RANK_LABEL[a.rank],
    loyal: a.loyal,
    points: a.points,
    bio: a.bio,
    universityId: a.universityId,
    university: universityById(a.universityId)?.name ?? null,
    createdAt: a.createdAt,
  }
}

export function validUniversityId(id: string | undefined) {
  if (!id) return false
  return id === NOT_AT_UNI.id || id === OTHER_UNI.id || universityById(id) !== null
}

export async function log(ctx: MutationCtx, actorId: Id<'agents'>, action: string, targetId?: string, meta?: unknown) {
  await ctx.db.insert('auditLog', {
    actorId,
    action,
    targetId,
    meta: meta === undefined ? undefined : JSON.stringify(meta),
    createdAt: Date.now(),
  })
}

// ------------------------------------------------------------------ queries

export const me = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const a = await agentFromToken(ctx, token)
    return a ? { ...publicAgent(a), status: a.status } : null
  },
})

export const leaderboard = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    // Members only: the board is part of the community, not a public page.
    const viewer = await agentFromToken(ctx, token)
    if (!viewer) return null
    const rows = await ctx.db
      .query('agents')
      .withIndex('by_points', (q) => q.eq('status', 'active'))
      .order('desc')
      .take(50)
    return rows.filter((a) => a.rank !== 'lead').map(publicAgent)
  },
})

export const profile = query({
  args: { token: v.optional(v.string()), handle: v.string() },
  handler: async (ctx, { token, handle }) => {
    const viewer = await agentFromToken(ctx, token)
    if (!viewer) return null
    const a = await ctx.db.query('agents').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
    if (!a || a.status !== 'active') return null
    const approved = await ctx.db
      .query('submissions')
      .withIndex('by_agent', (q) => q.eq('agentId', a._id))
      .order('desc')
      .collect()
    return {
      ...publicAgent(a),
      missions: approved
        .filter((s) => s.status === 'approved')
        .slice(0, 20)
        .map((s) => ({ _id: s._id, verifiedCount: s.verifiedCount ?? 0, reviewedAt: s.reviewedAt, challengeId: s.challengeId, freeformTitle: s.freeformTitle })),
    }
  },
})

export const roster = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const all = await ctx.db.query('agents').collect()
    return all
      .map((a) => ({ ...publicAgent(a), status: a.status, lastSeenAt: a.lastSeenAt }))
      .sort((x, y) => y.createdAt - x.createdAt)
  },
})

export const auditLog = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const rows = await ctx.db.query('auditLog').withIndex('by_createdAt').order('desc').take(200)
    const actors = new Map<string, string>()
    for (const r of rows) {
      if (!actors.has(r.actorId)) {
        const a = await ctx.db.get(r.actorId)
        actors.set(r.actorId, a?.displayHandle ?? '?')
      }
    }
    return rows.map((r) => ({ ...r, actor: actors.get(r.actorId) }))
  },
})

// ---------------------------------------------------------------- mutations

export const updateProfile = mutation({
  args: { token: v.string(), bio: v.string(), universityId: v.optional(v.string()) },
  handler: async (ctx, { token, bio, universityId }) => {
    const me = await requireAgent(ctx, token)
    const trimmed = bio.trim().slice(0, 200)
    if (universityId !== undefined && !validUniversityId(universityId)) throw new ConvexError('Pick a university from the list')
    await ctx.db.patch(me._id, { bio: trimmed || undefined, ...(universityId !== undefined ? { universityId } : {}) })
  },
})

/** Who is where. Members only. Agents with no mappable university are listed under 'other' / 'none'. */
export const coverage = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!(await agentFromToken(ctx, token))) return null
    const all = await ctx.db.query('agents').withIndex('by_points', (q) => q.eq('status', 'active')).order('desc').collect()
    const groups = new Map<string, ReturnType<typeof publicAgent>[]>()
    for (const a of all) {
      const key = a.universityId ?? 'unset'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(publicAgent(a))
    }
    return Array.from(groups, ([universityId, agents]) => {
      const u = universityById(universityId)
      return { universityId, name: u?.name ?? 'Undisclosed', lat: u?.lat ?? null, lng: u?.lng ?? null, agents }
    }).sort((x, y) => y.agents.length - x.agents.length)
  },
})

export const touch = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await agentFromToken(ctx, token)
    if (me && Date.now() - me.lastSeenAt > 10 * 60 * 1000) await ctx.db.patch(me._id, { lastSeenAt: Date.now() })
  },
})

export const logOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await sha256(token)
    const s = await ctx.db.query('sessions').withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash)).unique()
    if (s) await ctx.db.delete(s._id)
  },
})

export const setRank = mutation({
  args: { token: v.string(), agentId: v.id('agents'), rank },
  handler: async (ctx, { token, agentId, rank: next }) => {
    const lead = await requireLead(ctx, token)
    const target = await ctx.db.get(agentId)
    if (!target) throw new ConvexError('No such agent')
    if (target._id === lead._id) throw new ConvexError('You cannot change your own rank')
    await ctx.db.patch(agentId, { rank: next })
    await log(ctx, lead._id, 'rank', agentId, { from: target.rank, to: next, handle: target.handle })
  },
})

export const setStatus = mutation({
  args: { token: v.string(), agentId: v.id('agents'), status: v.union(v.literal('active'), v.literal('removed')) },
  handler: async (ctx, { token, agentId, status }) => {
    const lead = await requireLead(ctx, token)
    const target = await ctx.db.get(agentId)
    if (!target) throw new ConvexError('No such agent')
    if (target._id === lead._id) throw new ConvexError('You cannot remove yourself')
    await ctx.db.patch(agentId, { status })
    if (status === 'removed') {
      // Removal is immediate: every session dies with it.
      const sessions = await ctx.db.query('sessions').withIndex('by_agent', (q) => q.eq('agentId', agentId)).collect()
      for (const s of sessions) await ctx.db.delete(s._id)
    }
    await log(ctx, lead._id, status === 'removed' ? 'remove' : 'restore', agentId, { handle: target.handle })
  },
})

export const setLoyal = mutation({
  args: { token: v.string(), agentId: v.id('agents'), loyal: v.boolean() },
  handler: async (ctx, { token, agentId, loyal }) => {
    const lead = await requireLead(ctx, token)
    await ctx.db.patch(agentId, { loyal })
    await log(ctx, lead._id, loyal ? 'loyal' : 'unloyal', agentId)
  },
})

// ------------------------------------------------- internal (used by auth.ts)

export const byHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) =>
    ctx.db.query('agents').withIndex('by_handle', (q) => q.eq('handle', handle)).unique(),
})

export const create = internalMutation({
  args: { handle: v.string(), displayHandle: v.string(), passwordHash: v.string(), rank: v.optional(rank), universityId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('agents').withIndex('by_handle', (q) => q.eq('handle', args.handle)).unique()
    if (existing) throw new ConvexError('That TikTok username is already enrolled.')
    const now = Date.now()
    const id = await ctx.db.insert('agents', {
      handle: args.handle,
      displayHandle: args.displayHandle,
      passwordHash: args.passwordHash,
      rank: args.rank ?? 'junior',
      universityId: args.universityId,
      loyal: false,
      status: 'active',
      points: 0,
      createdAt: now,
      lastSeenAt: now,
    })
    if ((args.rank ?? 'junior') !== 'lead') await sendWelcome(ctx, id)
    return id
  },
})

export const createSession = internalMutation({
  args: { agentId: v.id('agents'), tokenHash: v.string() },
  handler: async (ctx, { agentId, tokenHash }) => {
    const now = Date.now()
    await ctx.db.insert('sessions', { agentId, tokenHash, createdAt: now, expiresAt: now + SESSION_DAYS * DAY })
    await ctx.db.patch(agentId, { lastSeenAt: now })
  },
})

export const setPasswordHash = internalMutation({
  args: { agentId: v.id('agents'), passwordHash: v.string(), actorId: v.id('agents'), revokeSessions: v.boolean(), silent: v.optional(v.boolean()) },
  handler: async (ctx, { agentId, passwordHash, actorId, revokeSessions, silent }) => {
    await ctx.db.patch(agentId, { passwordHash })
    if (silent) return
    if (revokeSessions) {
      const sessions = await ctx.db.query('sessions').withIndex('by_agent', (q) => q.eq('agentId', agentId)).collect()
      for (const s of sessions) await ctx.db.delete(s._id)
    }
    await log(ctx, actorId, actorId === agentId ? 'password-change' : 'password-reset', agentId)
  },
})

// ------------------------------------------------------- login throttling

const MAX_FAILURES = 5
const LOCK_BASE_MS = 5 * 60 * 1000

export const loginLock = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const row = await ctx.db.query('loginAttempts').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
    if (!row?.lockedUntil || row.lockedUntil < Date.now()) return null
    return row.lockedUntil
  },
})

export const recordLogin = internalMutation({
  args: { handle: v.string(), ok: v.boolean() },
  handler: async (ctx, { handle, ok }) => {
    const row = await ctx.db.query('loginAttempts').withIndex('by_handle', (q) => q.eq('handle', handle)).unique()
    if (ok) {
      if (row) await ctx.db.delete(row._id)
      return
    }
    const now = Date.now()
    const failures = (row && now - row.updatedAt < 60 * 60 * 1000 ? row.failures : 0) + 1
    // 5 fails -> 5 min, 10 -> 10 min, 15 -> 20 min, ...
    const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_BASE_MS * 2 ** Math.floor(failures / MAX_FAILURES - 1) : undefined
    if (row) await ctx.db.patch(row._id, { failures, lockedUntil, updatedAt: now })
    else await ctx.db.insert('loginAttempts', { handle, failures, lockedUntil, updatedAt: now })
  },
})

export const purgeLoginAttempts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = (await ctx.db.query('loginAttempts').collect()).filter((r) => Date.now() - r.updatedAt > 24 * 60 * 60 * 1000)
    for (const r of stale) await ctx.db.delete(r._id)
  },
})

export const purgeExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query('sessions').withIndex('by_expiresAt', (q) => q.lt('expiresAt', Date.now())).take(500)
    for (const s of expired) await ctx.db.delete(s._id)
  },
})
