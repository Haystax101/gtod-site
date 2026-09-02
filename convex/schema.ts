import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const tier = v.union(v.literal('flash'), v.literal('pro'))

// Vector width of the embedding model. Convex fixes this at table-definition
// time, so changing model means changing this number AND re-embedding every
// chunk. Whichever model is chosen must be configured to emit this width.
export const EMBEDDING_DIMENSIONS = 1536

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

  // The GTOD knowledge base Charge answers from. Small for now (the playbook),
  // so every enabled doc goes straight into the system prompt.
  knowledge: defineTable({
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    enabled: v.boolean(),
    // Always-on docs go into every system prompt regardless of the question.
    // The playbook is the one that earns this: it is short, it is GTOD's own
    // voice, and it is relevant to nearly everything Charge is asked.
    // Everything else is retrieved on demand.
    alwaysOn: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index('by_slug', ['slug']),

  // Reserved for when the knowledge base outgrows the prompt: chunk + embed docs
  // here and switch prompt.ts to vector retrieval. Unused until then.
  // Retrievable pieces of the knowledge base. Charge no longer receives every
  // document on every message - it receives the chunks that match the question.
  // `embedding` is optional so retrieval works lexically before an embedding
  // provider is configured, and upgrades to hybrid once one is.
  knowledgeChunks: defineTable({
    knowledgeId: v.id('knowledge'),
    slug: v.string(),
    docTitle: v.string(),
    heading: v.string(),
    text: v.string(),
    position: v.number(),
    embedding: v.optional(v.array(v.float64())),
    updatedAt: v.number(),
  })
    .index('by_knowledge', ['knowledgeId'])
    .index('by_slug', ['slug'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: EMBEDDING_DIMENSIONS,
    }),
})
