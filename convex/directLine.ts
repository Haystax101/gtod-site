/**
 * Direct line: one private channel per agent with HQ.
 */
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { agentFromToken, log, publicAgent, requireAgent, requireLead } from './agents'

const MAX_CHARS = 1500

export const DEFAULT_WELCOME = `Welcome to the programme, agent.

You're in as a Junior Agent. Your first mission is on the Missions tab: find a stranger this week, ask them "you here for uni then?", then write up how it went. I read every report myself and decide what it is worth. The good ones go up on the brief for everyone.

This channel comes straight to me. Use it for anything: a ruling on a mission, an idea, or just to report in.

- George, Lead Operative`

/** The welcome text HQ has set, the default if none, or '' if HQ has switched it off. */
export async function welcomeText(ctx: MutationCtx) {
  const row = await ctx.db.query('config').withIndex('by_key', (q) => q.eq('key', 'welcome')).unique()
  return row ? row.value : DEFAULT_WELCOME
}

/** Called once per enrolment: the first message in every agent's channel is from HQ. */
export async function sendWelcome(ctx: MutationCtx, agentId: Id<'agents'>) {
  const text = await welcomeText(ctx)
  if (!text.trim()) return
  await ctx.db.insert('directLine', { agentId, fromLead: true, body: text, createdAt: Date.now() })
}

export const welcome = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const row = await ctx.db.query('config').withIndex('by_key', (q) => q.eq('key', 'welcome')).unique()
    return { text: row ? row.value : DEFAULT_WELCOME, isDefault: !row }
  },
})

export const setWelcome = mutation({
  args: { token: v.string(), text: v.string() },
  handler: async (ctx, { token, text }) => {
    const lead = await requireLead(ctx, token)
    const value = text.slice(0, MAX_CHARS)
    const row = await ctx.db.query('config').withIndex('by_key', (q) => q.eq('key', 'welcome')).unique()
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() })
    else await ctx.db.insert('config', { key: 'welcome', value, updatedAt: Date.now() })
    await log(ctx, lead._id, 'welcome-edit', undefined, { chars: value.length })
  },
})

export const mine = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    return ctx.db.query('directLine').withIndex('by_agent', (q) => q.eq('agentId', me._id)).collect()
  },
})

export const send = mutation({
  args: { token: v.string(), body: v.string(), agentId: v.optional(v.id('agents')) },
  handler: async (ctx, { token, body, agentId }) => {
    const me = await requireAgent(ctx, token)
    const clean = body.trim().slice(0, MAX_CHARS)
    if (!clean) throw new ConvexError('Say something')
    const fromLead = me.rank === 'lead' && agentId !== undefined && agentId !== me._id
    const target = fromLead ? agentId! : me._id
    if (fromLead && !(await ctx.db.get(target))) throw new ConvexError('No such agent')
    await ctx.db.insert('directLine', { agentId: target, fromLead, body: clean, createdAt: Date.now() })
  },
})

export const markRead = mutation({
  args: { token: v.string(), agentId: v.optional(v.id('agents')) },
  handler: async (ctx, { token, agentId }) => {
    const me = await requireAgent(ctx, token)
    const asLead = me.rank === 'lead' && agentId !== undefined
    const target = asLead ? agentId! : me._id
    const rows = await ctx.db.query('directLine').withIndex('by_agent', (q) => q.eq('agentId', target)).collect()
    for (const m of rows) {
      // The lead reads agents' messages; an agent reads the lead's.
      if (m.readAt === undefined && m.fromLead !== asLead) await ctx.db.patch(m._id, { readAt: Date.now() })
    }
  },
})

/** HQ inbox: one row per agent who has ever used the line, unread first. */
export const inbox = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    const all = await ctx.db.query('directLine').collect()
    const byAgent = new Map<string, { last: typeof all[number]; unread: number }>()
    for (const m of all) {
      const cur = byAgent.get(m.agentId) ?? { last: m, unread: 0 }
      if (m.createdAt > cur.last.createdAt) cur.last = m
      if (!m.fromLead && m.readAt === undefined) cur.unread++
      byAgent.set(m.agentId, cur)
    }
    const out = []
    for (const [agentId, { last, unread }] of byAgent) {
      const a = await ctx.db.get(agentId as any)
      if (a) out.push({ agent: publicAgent(a as any), last, unread })
    }
    return out.sort((x, y) => y.unread - x.unread || y.last.createdAt - x.last.createdAt)
  },
})

export const conversation = query({
  args: { token: v.string(), agentId: v.id('agents') },
  handler: async (ctx, { token, agentId }) => {
    await requireLead(ctx, token)
    const a = await ctx.db.get(agentId)
    const messages = await ctx.db.query('directLine').withIndex('by_agent', (q) => q.eq('agentId', agentId)).collect()
    return { agent: a ? publicAgent(a) : null, messages }
  },
})

export const unreadForMe = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return 0
    if (me.rank === 'lead') {
      const rows = await ctx.db.query('directLine').withIndex('by_unread_for_lead', (q) => q.eq('fromLead', false).eq('readAt', undefined)).collect()
      return rows.length
    }
    const rows = await ctx.db.query('directLine').withIndex('by_agent', (q) => q.eq('agentId', me._id)).collect()
    return rows.filter((m) => m.fromLead && m.readAt === undefined).length
  },
})
