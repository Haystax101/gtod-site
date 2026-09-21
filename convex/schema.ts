import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// The ladder. Promotion is George's call, made from HQ; nothing in the code
// promotes anyone automatically. `lead` is George (and later Charlie).
export const rank = v.union(
  v.literal('junior'),
  v.literal('senior'),
  v.literal('advanced'),
  v.literal('lead'),
)

export const submissionStatus = v.union(
  v.literal('processing'), // legacy: audio uploaded, classifier running
  v.literal('pending'),    // written up and waiting on HQ to read it
  v.literal('approved'),
  v.literal('rejected'),
)

export default defineSchema({
  // One row per member. The handle IS the identity: it is their TikTok
  // username, lowercased for uniqueness, with displayHandle keeping the case
  // they typed. No email, no real name, nothing else personal - the community
  // works without it, so we do not ask.
  agents: defineTable({
    handle: v.string(),
    displayHandle: v.string(),
    passwordHash: v.string(),
    rank,
    // Badge, not a rank: a donating junior stays a junior on the ladder.
    loyal: v.boolean(),
    // `removed` keeps the row so the handle cannot be re-registered.
    status: v.union(v.literal('active'), v.literal('removed')),
    bio: v.optional(v.string()),
    // Id from convex/lib/universities.ts, or 'none' / 'other'. Drives the coverage map.
    universityId: v.optional(v.string()),
    // Free text when universityId is 'other': what they typed, so HQ can add it to the list.
    universityOther: v.optional(v.string()),
    // Id from convex/lib/years.ts. Absent = 'fresher' (everyone who enrolled before it existed).
    year: v.optional(v.string()),
    // Verified encounters, denormalised from approved submissions so the
    // leaderboard is one indexed read.
    points: v.number(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    stripeCustomerId: v.optional(v.string()),
  })
    .index('by_handle', ['handle'])
    .index('by_points', ['status', 'points']),

  // Opaque bearer tokens. Only the hash is stored, so a leaked database does
  // not hand out logins.
  sessions: defineTable({
    agentId: v.id('agents'),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_agent', ['agentId'])
    .index('by_expiresAt', ['expiresAt']),

  // Failed-login tracking per handle. Five failures locks the handle for a
  // growing window; a successful login clears it. Rows are tiny and pruned.
  loginAttempts: defineTable({
    handle: v.string(),
    failures: v.number(),
    lockedUntil: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_handle', ['handle']),

  // The official mission list. Agents can also log a free-form mission
  // (submission.freeformTitle) without a row here.
  challenges: defineTable({
    title: v.string(),
    brief: v.string(),
    // The line the mission is built around. Defaults to the founding phrase.
    phrase: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    createdBy: v.id('agents'),
    createdAt: v.number(),
    sortOrder: v.number(),
  }).index('by_status', ['status', 'sortOrder']),

  // A field report: the agent writes up what happened in their own words and
  // HQ reads it and decides whether it earns a point. Nothing is automated:
  // every story waits for a human.
  submissions: defineTable({
    agentId: v.id('agents'),
    challengeId: v.optional(v.id('challenges')),
    freeformTitle: v.optional(v.string()),
    // The story itself. Optional only so the audio-era rows below still
    // validate; every row written from now on has one.
    story: v.optional(v.string()),
    status: submissionStatus,
    // Points awarded by HQ on approval. Named for the era when it counted
    // encounters heard on a recording; it is simply points now.
    verifiedCount: v.optional(v.number()),
    reviewedBy: v.optional(v.union(v.id('agents'), v.literal('auto'))),
    reviewNote: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),

    // ---- Legacy: the voice-evidence era. Nothing writes these any more.
    // They stay so old rows keep validating and so HQ can finish reviewing
    // whatever is left before the purge cron clears the audio.
    claimedCount: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    bytes: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    link: v.optional(v.string()),
    note: v.optional(v.string()),
    transcript: v.optional(v.string()),
    verdict: v.optional(
      v.object({
        saidPhrase: v.boolean(),
        gotResponse: v.boolean(),
        encounterCount: v.number(),
        confidence: v.number(),
        reasoning: v.string(),
        model: v.string(),
      }),
    ),
    classifierError: v.optional(v.string()),
    evidencePurgeAt: v.optional(v.number()),
  })
    .index('by_agent', ['agentId', 'createdAt'])
    .index('by_status', ['status', 'createdAt'])
    .index('by_purge', ['evidencePurgeAt']),

  threads: defineTable({
    title: v.string(),
    category: v.union(v.literal('general'), v.literal('missions'), v.literal('intel')),
    authorId: v.id('agents'),
    pinned: v.boolean(),
    locked: v.boolean(),
    hidden: v.boolean(),
    postCount: v.number(),
    lastPostAt: v.number(),
    createdAt: v.number(),
  }).index('by_activity', ['hidden', 'pinned', 'lastPostAt']),

  posts: defineTable({
    threadId: v.id('threads'),
    authorId: v.id('agents'),
    body: v.string(),
    hidden: v.boolean(),
    createdAt: v.number(),
  }).index('by_thread', ['threadId', 'createdAt']),

  // Year rooms: one live chat per year group (room = a year id). Only agents
  // in that year can read or post; the lead can see every room.
  roomMessages: defineTable({
    room: v.string(),
    authorId: v.id('agents'),
    body: v.string(),
    hidden: v.boolean(),
    createdAt: v.number(),
  }).index('by_room', ['room', 'createdAt']),

  reports: defineTable({
    reporterId: v.id('agents'),
    postId: v.id('posts'),
    reason: v.string(),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_open', ['resolvedAt', 'createdAt']),

  // One private channel per agent with HQ. `fromLead` says which side spoke.
  directLine: defineTable({
    agentId: v.id('agents'),
    fromLead: v.boolean(),
    body: v.string(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_agent', ['agentId', 'createdAt'])
    .index('by_unread_for_lead', ['fromLead', 'readAt', 'createdAt']),

  donations: defineTable({
    agentId: v.optional(v.id('agents')),
    stripeSessionId: v.string(),
    amountPence: v.number(),
    currency: v.string(),
    createdAt: v.number(),
  }).index('by_stripeSessionId', ['stripeSessionId']),

  // Dispatches: the blog. Written by the lead only; read by members.
  dispatches: defineTable({
    title: v.string(),
    body: v.string(),
    authorId: v.id('agents'),
    status: v.union(v.literal('draft'), v.literal('published')),
    publishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_status', ['status', 'publishedAt']),

  // Small key/value settings HQ edits in the app (e.g. the welcome message).
  config: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  auditLog: defineTable({
    actorId: v.id('agents'),
    action: v.string(),
    targetId: v.optional(v.string()),
    meta: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_createdAt', ['createdAt']),
})
