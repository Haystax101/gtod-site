import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const tier = v.union(v.literal('flash'), v.literal('pro'))

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    plan: tier,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_clerkId', ['clerkId'])
    .index('by_stripeCustomerId', ['stripeCustomerId']),

  conversations: defineTable({
    userId: v.id('users'),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId', 'updatedAt']),

  messages: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    status: v.union(v.literal('streaming'), v.literal('done'), v.literal('error')),
    tier: v.optional(tier),
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    attachmentIds: v.optional(v.array(v.id('attachments'))),
    createdAt: v.number(),
  })
    .index('by_conversation', ['conversationId', 'createdAt'])
    .index('by_user', ['userId', 'createdAt']),

  // Uploaded CVs / cover letters. Only the extracted text is kept (parsed in the
  // browser), never the file, and rows are deleted after 30 days by a cron.
  attachments: defineTable({
    userId: v.id('users'),
    name: v.string(),
    kind: v.string(),
    text: v.string(),
    chars: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  // Per-user, per-calendar-month spend. Costs are tracked in micro-dollars.
  usage: defineTable({
    userId: v.id('users'),
    month: v.string(),
    messages: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costMicros: v.number(),
  }).index('by_user_month', ['userId', 'month']),

  // The GTOD knowledge base Charge answers from. Small for now (the playbook
  // plus video notes), so every enabled doc goes straight into the system prompt.
  knowledge: defineTable({
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    enabled: v.boolean(),
    updatedAt: v.number(),
    // Attribution. 'manual' for hand-written docs, 'tiktok' for video notes
    // produced by scripts/ingest-tiktok.mjs.
    sourceType: v.optional(v.union(v.literal('manual'), v.literal('tiktok'))),
    sourceId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  })
    .index('by_slug', ['slug'])
    .index('by_sourceId', ['sourceId']),

  // Reserved for when the knowledge base outgrows the prompt: chunk + embed docs
  // here and switch prompt.ts to vector retrieval. Unused until then.
  knowledgeChunks: defineTable({
    knowledgeId: v.id('knowledge'),
    text: v.string(),
    embedding: v.array(v.float64()),
  }).vectorIndex('by_embedding', { vectorField: 'embedding', dimensions: 1536 }),
})
