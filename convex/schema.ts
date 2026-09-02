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
    // Voice draws from the same costMicros envelope as chat, so a user cannot
    // exceed the monthly ceiling by switching between them.
    voiceSeconds: v.optional(v.number()),
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

  // ---------------------------------------------------------------- timeline

  // Curated employer schemes. Hand-maintained, not scraped: scraping vacancy
  // data carries UK database-right and terms-of-service exposure, and stale
  // dates destroy trust faster than missing ones. `verified` marks a date a
  // human has confirmed against the employer's own page.
  schemes: defineTable({
    slug: v.string(),
    employer: v.string(),
    name: v.string(),
    level: v.optional(v.number()),
    sector: v.optional(v.string()),
    url: v.string(),
    // Dates are optional because many schemes recruit on a rolling basis and
    // publish no window at all. Never invent one.
    opensAt: v.optional(v.number()),
    closesAt: v.optional(v.number()),
    rolling: v.optional(v.boolean()),
    locations: v.optional(v.array(v.string())),
    entryRequirements: v.optional(v.string()),
    salary: v.optional(v.string()),
    notes: v.optional(v.string()),
    verified: v.boolean(),
    verifiedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_closesAt', ['closesAt']),

  // A scheme a user is tracking, and where they have got to with it.
  applications: defineTable({
    userId: v.id('users'),
    schemeId: v.optional(v.id('schemes')),
    // Free-text fallback so a user can track something not in our directory.
    customEmployer: v.optional(v.string()),
    customName: v.optional(v.string()),
    stage: v.union(
      v.literal('interested'),
      v.literal('applying'),
      v.literal('submitted'),
      v.literal('online_test'),
      v.literal('video_interview'),
      v.literal('assessment_centre'),
      v.literal('final_interview'),
      v.literal('offer'),
      v.literal('rejected'),
      v.literal('withdrawn'),
    ),
    deadlineAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId', 'updatedAt'])
    .index('by_user_stage', ['userId', 'stage']),

  // Weekly todos. Generated from application stage and deadlines by a cron,
  // plus anything the user adds themselves.
  tasks: defineTable({
    userId: v.id('users'),
    applicationId: v.optional(v.id('applications')),
    title: v.string(),
    detail: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    weekOf: v.string(), // ISO date of the Monday, so a week can be queried whole
    source: v.union(v.literal('generated'), v.literal('user')),
    doneAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user_week', ['userId', 'weekOf'])
    .index('by_user_done', ['userId', 'doneAt']),

  // ---------------------------------------------------------------- coaching

  // Reusable competency answers. The compounding asset: the more a user banks,
  // the more expensive leaving becomes.
  answers: defineTable({
    userId: v.id('users'),
    competency: v.string(),
    prompt: v.string(),
    body: v.string(),
    starComplete: v.optional(v.boolean()),
    lastCritiqueAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId', 'updatedAt'])
    .index('by_user_competency', ['userId', 'competency']),

  // Charge's critique of an answer, kept so a user can see progress over time.
  critiques: defineTable({
    answerId: v.id('answers'),
    userId: v.id('users'),
    body: v.string(),
    strengths: v.optional(v.array(v.string())),
    fixes: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index('by_answer', ['answerId', 'createdAt']),

  // A rejection, and the debrief built from it. The modal outcome of this
  // market and the thing no competitor addresses at all.
  rejections: defineTable({
    userId: v.id('users'),
    applicationId: v.optional(v.id('applications')),
    stage: v.string(),
    feedbackGiven: v.optional(v.string()),
    debrief: v.optional(v.string()),
    actions: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index('by_user', ['userId', 'createdAt']),

  // --------------------------------------------------------------- community

  // A cohort is scoped to a scheme and intake year, so it is never a general
  // teen forum. Narrow scope is both the product point and the safety posture.
  cohorts: defineTable({
    slug: v.string(),
    name: v.string(),
    schemeId: v.optional(v.id('schemes')),
    intakeYear: v.number(),
    memberCount: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_intakeYear', ['intakeYear']),

  cohortMembers: defineTable({
    cohortId: v.id('cohorts'),
    userId: v.id('users'),
    joinedAt: v.number(),
  })
    .index('by_cohort', ['cohortId'])
    .index('by_user', ['userId']),

  // Posts default to `pending`. The audience is 16-19, so publication is a
  // decision someone makes, not the default state of user input.
  posts: defineTable({
    cohortId: v.id('cohorts'),
    userId: v.id('users'),
    body: v.string(),
    replyToId: v.optional(v.id('posts')),
    status: v.union(
      v.literal('pending'),
      v.literal('visible'),
      v.literal('hidden'),
      v.literal('removed'),
    ),
    moderatedBy: v.optional(v.string()),
    moderatedAt: v.optional(v.number()),
    moderationNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_cohort', ['cohortId', 'createdAt'])
    .index('by_status', ['status', 'createdAt'])
    .index('by_user', ['userId', 'createdAt']),

  reports: defineTable({
    postId: v.id('posts'),
    reporterId: v.id('users'),
    reason: v.string(),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_post', ['postId'])
    .index('by_unresolved', ['resolvedAt', 'createdAt']),

  blocks: defineTable({
    userId: v.id('users'),
    blockedUserId: v.id('users'),
    createdAt: v.number(),
  }).index('by_user', ['userId']),

  // ------------------------------------------------------------------- voice

  // One row per live audio session. Written before the session starts so an
  // abandoned or crashed session still consumes its reservation rather than
  // silently costing nothing until reconciliation.
  voiceSessions: defineTable({
    userId: v.id('users'),
    kind: v.union(v.literal('interview'), v.literal('checkin'), v.literal('practice')),
    applicationId: v.optional(v.id('applications')),
    status: v.union(
      v.literal('reserved'),
      v.literal('active'),
      v.literal('ended'),
      v.literal('expired'),
    ),
    reservedMinutes: v.number(),
    seconds: v.number(),
    costMicros: v.number(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
  })
    .index('by_user', ['userId', 'startedAt'])
    .index('by_user_status', ['userId', 'status']),

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
