/**
 * Dispatches: written pieces from the Lead Operative. Title + body, drafts
 * and published, members-only to read, lead-only to write.
 */
import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { agentFromToken, log, publicAgent, requireLead } from './agents'

const MAX_TITLE = 120
const MAX_BODY = 20_000

export const list = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!(await agentFromToken(ctx, token))) return null
    const rows = await ctx.db.query('dispatches').withIndex('by_status', (q) => q.eq('status', 'published')).order('desc').take(100)
    return rows.map((d) => ({
      _id: d._id,
      title: d.title,
      publishedAt: d.publishedAt ?? d.createdAt,
      words: d.body.split(/\s+/).filter(Boolean).length,
      excerpt: d.body.replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }))
  },
})

export const latest = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    if (!(await agentFromToken(ctx, token))) return null
    const d = await ctx.db.query('dispatches').withIndex('by_status', (q) => q.eq('status', 'published')).order('desc').first()
    if (!d) return null
    return { _id: d._id, title: d.title, publishedAt: d.publishedAt ?? d.createdAt, excerpt: d.body.replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 200) }
  },
})

export const get = query({
  args: { token: v.optional(v.string()), id: v.id('dispatches') },
  handler: async (ctx, { token, id }) => {
    const me = await agentFromToken(ctx, token)
    if (!me) return null
    const d = await ctx.db.get(id)
    if (!d || (d.status !== 'published' && me.rank !== 'lead')) return null
    const author = await ctx.db.get(d.authorId)
    return { ...d, author: author ? publicAgent(author) : null }
  },
})

// ---------------------------------------------------------------------- HQ

export const all = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireLead(ctx, token)
    return (await ctx.db.query('dispatches').collect()).sort((a, b) => b.updatedAt - a.updatedAt)
  },
})

export const save = mutation({
  args: { token: v.string(), id: v.optional(v.id('dispatches')), title: v.string(), body: v.string(), publish: v.optional(v.boolean()) },
  handler: async (ctx, { token, id, title, body, publish }) => {
    const lead = await requireLead(ctx, token)
    const cleanTitle = title.trim().slice(0, MAX_TITLE)
    const cleanBody = body.trim().slice(0, MAX_BODY)
    if (!cleanTitle) throw new ConvexError('Give it a title')
    if (publish && !cleanBody) throw new ConvexError('Cannot publish an empty dispatch')
    const now = Date.now()
    if (id) {
      const d = await ctx.db.get(id)
      if (!d) throw new ConvexError('Not found')
      const status = publish === undefined ? d.status : publish ? 'published' : 'draft'
      await ctx.db.patch(id, {
        title: cleanTitle,
        body: cleanBody,
        status,
        publishedAt: status === 'published' ? d.publishedAt ?? now : d.publishedAt,
        updatedAt: now,
      })
      await log(ctx, lead._id, publish ? 'dispatch-publish' : 'dispatch-edit', id, cleanTitle)
      return id
    }
    const newId = await ctx.db.insert('dispatches', {
      title: cleanTitle,
      body: cleanBody,
      authorId: lead._id,
      status: publish ? 'published' : 'draft',
      publishedAt: publish ? now : undefined,
      createdAt: now,
      updatedAt: now,
    })
    await log(ctx, lead._id, publish ? 'dispatch-publish' : 'dispatch-draft', newId, cleanTitle)
    return newId
  },
})

export const remove = mutation({
  args: { token: v.string(), id: v.id('dispatches') },
  handler: async (ctx, { token, id }) => {
    const lead = await requireLead(ctx, token)
    const d = await ctx.db.get(id)
    if (!d) return
    await ctx.db.delete(id)
    await log(ctx, lead._id, 'dispatch-delete', id, d.title)
  },
})
