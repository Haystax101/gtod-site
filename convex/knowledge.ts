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
  args: { slugs: v.optional(v.array(v.string())) },
  handler: async (ctx, { slugs }): Promise<{ documents: number; chunks: number; embedded: boolean }> => {
    const all = await ctx.runQuery(internal.knowledge.enabledDocs, {})
    // Reindexing everything is fine for the hand-written corpus, but the video
    // notes run to four figures, so the ingest script reindexes in batches.
    const docs = slugs ? all.filter((d) => slugs.includes(d.slug)) : all
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
        sourceType: doc.sourceType,
        sourceUrl: doc.sourceUrl,
        postedAt: doc.postedAt,
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
    sourceType: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    postedAt: v.optional(v.number()),
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
  handler: async (ctx, { knowledgeId, sourceType, sourceUrl, postedAt, chunks }) => {
    const existing = await ctx.db
      .query('knowledgeChunks')
      .withIndex('by_knowledge', (q) => q.eq('knowledgeId', knowledgeId))
      .collect()
    for (const row of existing) await ctx.db.delete(row._id)
    const updatedAt = Date.now()
    for (const chunk of chunks) {
      await ctx.db.insert('knowledgeChunks', { knowledgeId, updatedAt, sourceType, sourceUrl, postedAt, ...chunk })
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

// ---------------------------------------------------------------------------
// Video note ingest (scripts/ingest-tiktok.mjs)
// ---------------------------------------------------------------------------

/**
 * Which videos already have notes? The script asks for this first so a repeat
 * export only transcribes what is new.
 */
export const ingestedSourceIds = internalQuery({
  args: { sourceType: v.optional(v.string()) },
  handler: async (ctx, { sourceType = 'tiktok' }) => {
    const docs = await ctx.db.query('knowledge').collect()
    return docs.filter((d) => d.sourceType === sourceType && d.sourceId).map((d) => d.sourceId!)
  },
})

const noteFields = {
  sourceId: v.string(),
  title: v.string(),
  content: v.string(),
  sourceUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  postedAt: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
}

/**
 * Insert or update video notes, keyed on the video id so re-running is safe.
 * Notes are never `alwaysOn`: there are far too many to pin into every prompt,
 * so they earn their place through retrieval. Returns the slugs written, which
 * the script feeds straight back into `reindex`.
 */
export const upsertVideoNotes = internalMutation({
  args: { notes: v.array(v.object(noteFields)) },
  handler: async (ctx, { notes }) => {
    let created = 0
    let updated = 0
    const slugs: string[] = []
    for (const note of notes) {
      const slug = `tiktok-${note.sourceId}`
      slugs.push(slug)
      const doc = {
        slug,
        title: note.title,
        content: note.content,
        enabled: true,
        alwaysOn: false,
        updatedAt: Date.now(),
        sourceType: 'tiktok' as const,
        sourceId: note.sourceId,
        sourceUrl: note.sourceUrl,
        sourceTitle: note.sourceTitle,
        postedAt: note.postedAt,
        tags: note.tags,
      }
      const existing = await ctx.db
        .query('knowledge')
        .withIndex('by_sourceId', (q) => q.eq('sourceId', note.sourceId))
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('knowledge', doc)
        created++
      }
    }
    return { created, updated, slugs }
  },
})

/**
 * Attach public post URLs discovered after ingest, matched on video id.
 * The TikTok data export only carries expiring CDN links, so permanent links
 * are resolved separately and backfilled here.
 */
export const attachSourceUrls = internalMutation({
  args: { links: v.array(v.object({ sourceId: v.string(), sourceUrl: v.string() })) },
  handler: async (ctx, { links }) => {
    let updated = 0
    const slugs: string[] = []
    for (const link of links) {
      const doc = await ctx.db
        .query('knowledge')
        .withIndex('by_sourceId', (q) => q.eq('sourceId', link.sourceId))
        .first()
      if (!doc) continue
      await ctx.db.patch(doc._id, { sourceUrl: link.sourceUrl, updatedAt: Date.now() })
      slugs.push(doc.slug)
      updated++
    }
    return { updated, slugs }
  },
})

/**
 * Remove every document from a given source. Handy if an ingest run goes wrong:
 *   npx convex run knowledge:removeSource '{"sourceType":"tiktok"}'
 */
export const removeSource = internalMutation({
  args: { sourceType: v.string() },
  handler: async (ctx, { sourceType }) => {
    const docs = await ctx.db.query('knowledge').collect()
    const doomed = docs.filter((d) => d.sourceType === sourceType)
    for (const doc of doomed) {
      const chunks = await ctx.db
        .query('knowledgeChunks')
        .withIndex('by_knowledge', (q) => q.eq('knowledgeId', doc._id))
        .collect()
      for (const chunk of chunks) await ctx.db.delete(chunk._id)
      await ctx.db.delete(doc._id)
    }
    return `removed ${doomed.length} documents`
  },
})
