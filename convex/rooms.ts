/**
 * Year rooms: a group chat per year group.
 *
 * Membership is derived, not stored: your year is your room. Change your
 * year on your file and you move rooms. The Lead Operative can read and post
 * in every room; everyone else only their own.
 */
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { agentFromToken, log, publicAgent, requireAgent, requireLead } from './agents'
import { DEFAULT_YEAR, YEARS, isYearId, yearById } from './lib/years'
import { screen } from './forum'

const MAX_CHARS = 1000
const PAGE = 150
const MESSAGES_PER_MINUTE = 12
const MINUTE = 60 * 1000

function roomOf(agent: Doc<'agents'>) {
  return agent.year ?? DEFAULT_YEAR
}

function canEnter(agent: Doc<'agents'>, room: string) {
  return agent.rank === 'lead' || roomOf(agent) === room
}

export function roomLabel(room: string) {
  const y = yearById(room)
  return room === 'fresher' ? "Freshers' room" : room === 'apprentice' ? 'Apprentices’ room' : `${y.label} room`
}

/** The rooms this agent can see, with headcounts and the latest message. */
export const list = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    const agents = await ctx.db.query('agents').withIndex('by_points', (q) => q.eq('status', 'active')).collect()
    const counts = new Map<string, number>()
    for (const a of agents) if (a.rank !== 'lead') counts.set(roomOf(a), (counts.get(roomOf(a)) ?? 0) + 1)
    const rooms = me.rank === 'lead' ? YEARS.map((y) => y.id) : [roomOf(me)]
    return Promise.all(
      rooms.map(async (room) => {
        const last = await ctx.db.query('roomMessages').withIndex('by_room', (q) => q.eq('room', room)).order('desc').first()
        return { room, label: roomLabel(room), members: counts.get(room) ?? 0, lastAt: last?.createdAt ?? null, mine: roomOf(me) === room }
      }),
    )
  },
})

export const messages = query({
  args: { token: v.optional(v.string()), room: v.string() },
  handler: async (ctx, { token, room }) => {
    const me = await agentFromToken(ctx, token)
    if (!me || !isYearId(room) || !canEnter(me, room)) return null
    const rows = await ctx.db.query('roomMessages').withIndex('by_room', (q) => q.eq('room', room)).order('desc').take(PAGE)
    rows.reverse()
    const cache = new Map<string, ReturnType<typeof publicAgent> | null>()
    const out = []
    for (const m of rows) {
      if (m.hidden && me.rank !== 'lead') continue
      if (!cache.has(m.authorId)) {
        const a = await ctx.db.get(m.authorId)
        cache.set(m.authorId, a ? publicAgent(a) : null)
      }
      out.push({ ...m, author: cache.get(m.authorId) })
    }
    return { room, label: roomLabel(room), messages: out }
  },
})

export const send = mutation({
  args: { token: v.string(), room: v.string(), body: v.string() },
  handler: async (ctx, { token, room, body }) => {
    const me = await requireAgent(ctx, token)
    if (!isYearId(room) || !canEnter(me, room)) throw new ConvexError('That room is not yours')
    const clean = body.trim()
    if (!clean) throw new ConvexError('Say something')
    if (clean.length > MAX_CHARS) throw new ConvexError(`Keep it under ${MAX_CHARS} characters`)
    const recent = await ctx.db
      .query('roomMessages')
      .withIndex('by_room', (q) => q.eq('room', room).gt('createdAt', Date.now() - MINUTE))
      .collect()
    if (recent.filter((m) => m.authorId === me._id).length >= MESSAGES_PER_MINUTE) throw new ConvexError('Slow down, agent.')
    await ctx.db.insert('roomMessages', { room, authorId: me._id, body: clean, hidden: screen(clean), createdAt: Date.now() })
  },
})

export const moderate = mutation({
  args: { token: v.string(), messageId: v.id('roomMessages'), hidden: v.boolean() },
  handler: async (ctx, { token, messageId, hidden }) => {
    const lead = await requireLead(ctx, token)
    await ctx.db.patch(messageId, { hidden })
    await log(ctx, lead._id, hidden ? 'room-hide' : 'room-unhide', messageId)
  },
})
