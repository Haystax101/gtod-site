import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'
import { PLAYBOOK } from './content/playbook'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query('knowledge').collect()
    return docs.map(({ content, ...rest }) => ({ ...rest, chars: content.length }))
  },
})

export const upsert = internalMutation({
  args: { slug: v.string(), title: v.string(), content: v.string(), enabled: v.optional(v.boolean()) },
  handler: async (ctx, { slug, title, content, enabled }) => {
    const existing = await ctx.db.query('knowledge').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
    const doc = { slug, title, content, enabled: enabled ?? true, updatedAt: Date.now() }
    if (existing) {
      await ctx.db.patch(existing._id, doc)
      return existing._id
    }
    return ctx.db.insert('knowledge', doc)
  },
})

// npx convex run knowledge:seed
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('knowledge').withIndex('by_slug', (q) => q.eq('slug', PLAYBOOK.slug)).unique()
    const doc = { ...PLAYBOOK, enabled: true, updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, doc)
    else await ctx.db.insert('knowledge', doc)
    return 'seeded'
  },
})
