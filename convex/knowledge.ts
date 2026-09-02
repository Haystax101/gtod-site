import { internalAction, internalMutation, internalQuery, query } from './_generated/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { PLAYBOOK } from './content/playbook'
import { chunkDocument } from './retrieval'
import { embed } from './embeddings'

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
    const doc = { ...PLAYBOOK, enabled: true, alwaysOn: true, updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, doc)
    else await ctx.db.insert('knowledge', doc)
    return 'seeded'
  },
})

// ---------------------------------------------------------------- chunking

/**
 * Rebuild the chunk index for every enabled document.
 *
 * Run after changing knowledge content:  npx convex run knowledge:reindex
 *
 * Embedding is best-effort. With no embedding provider configured the chunks
 * are still written and retrieval runs lexically, so the knowledge base works
 * before anyone has picked a vendor.
 */
export const reindex = internalAction({
  args: {},
  handler: async (ctx): Promise<{ documents: number; chunks: number; embedded: boolean }> => {
    const docs = await ctx.runQuery(internal.knowledge.enabledDocs, {})
    let total = 0
    let embedded = false

    for (const doc of docs) {
      const chunks = chunkDocument({ slug: doc.slug, title: doc.title, content: doc.content })
      let vectors: number[][] | null = null
      try {
        vectors = await embed(chunks.map((c) => c.text))
        if (vectors) embedded = true
      } catch (err) {
        // A broken embedding provider must not cost us the lexical index.
        console.error(`embedding failed for ${doc.slug}, indexing lexically only`, err)
      }
      await ctx.runMutation(internal.knowledge.replaceChunks, {
        knowledgeId: doc._id,
        chunks: chunks.map((c, i) => ({
          slug: c.slug,
          docTitle: c.docTitle,
          heading: c.heading,
          text: c.text,
          position: c.position,
          embedding: vectors?.[i],
        })),
      })
      total += chunks.length
    }
    return { documents: docs.length, chunks: total, embedded }
  },
})

export const enabledDocs = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('knowledge').collect()).filter((d) => d.enabled),
})

export const replaceChunks = internalMutation({
  args: {
    knowledgeId: v.id('knowledge'),
    chunks: v.array(
      v.object({
        slug: v.string(),
        docTitle: v.string(),
        heading: v.string(),
        text: v.string(),
        position: v.number(),
        embedding: v.optional(v.array(v.float64())),
      }),
    ),
  },
  handler: async (ctx, { knowledgeId, chunks }) => {
    const existing = await ctx.db
      .query('knowledgeChunks')
      .withIndex('by_knowledge', (q) => q.eq('knowledgeId', knowledgeId))
      .collect()
    for (const row of existing) await ctx.db.delete(row._id)
    const updatedAt = Date.now()
    for (const chunk of chunks) {
      await ctx.db.insert('knowledgeChunks', { knowledgeId, updatedAt, ...chunk })
    }
  },
})

/** Chunks for lexical scoring. Small corpus, so the whole set is loaded. */
export const allChunks = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('knowledgeChunks').collect()).map(
      ({ embedding, ...rest }) => rest,
    ),
})

export const chunksByIds = internalQuery({
  args: { ids: v.array(v.id('knowledgeChunks')) },
  handler: async (ctx, { ids }) => {
    const out = []
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (row) {
        const { embedding, ...rest } = row
        out.push(rest)
      }
    }
    return out
  },
})

/** Documents pinned into every prompt, regardless of the question. */
export const alwaysOnDocs = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('knowledge').collect()).filter((d) => d.enabled && d.alwaysOn),
})
