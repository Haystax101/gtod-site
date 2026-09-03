import { internalMutation, internalQuery, query } from './_generated/server'
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
    return ctx.db.insert('knowledge', { ...doc, sourceType: 'manual' as const })
  },
})

// npx convex run knowledge:seed
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('knowledge').withIndex('by_slug', (q) => q.eq('slug', PLAYBOOK.slug)).unique()
    const doc = { ...PLAYBOOK, enabled: true, updatedAt: Date.now(), sourceType: 'manual' as const }
    if (existing) await ctx.db.patch(existing._id, doc)
    else await ctx.db.insert('knowledge', doc)
    return 'seeded'
  },
})

// ---------------------------------------------------------------------------
// Video note ingest (scripts/ingest-tiktok.mjs)
// ---------------------------------------------------------------------------

// Which videos have we already turned into notes? The script asks for this
// first so a repeat export only transcribes what's new.
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

// Insert or update video notes, keyed on the video id so re-running is safe.
export const upsertVideoNotes = internalMutation({
  args: { notes: v.array(v.object(noteFields)) },
  handler: async (ctx, { notes }) => {
    let created = 0
    let updated = 0
    for (const note of notes) {
      const doc = {
        slug: `tiktok-${note.sourceId}`,
        title: note.title,
        content: note.content,
        enabled: true,
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
    return { created, updated }
  },
})

// Remove every note from a given source. Handy if an ingest run goes wrong:
//   npx convex run knowledge:removeSource '{"sourceType":"tiktok"}'
export const removeSource = internalMutation({
  args: { sourceType: v.string() },
  handler: async (ctx, { sourceType }) => {
    const docs = await ctx.db.query('knowledge').collect()
    const doomed = docs.filter((d) => d.sourceType === sourceType)
    await Promise.all(doomed.map((d) => ctx.db.delete(d._id)))
    return `removed ${doomed.length} documents`
  },
})
