/**
 * Community cohorts: join, read, post, report, block.
 *
 * The shape of this feature is a safety decision as much as a product one.
 *
 * A cohort is ONE scheme plus ONE intake year. It is never a general teen
 * forum. That narrowness is the whole point twice over: it is why the feature
 * is useful (everyone in the room is applying to the same thing, at the same
 * time, and has the same questions) and it is why it is defensible (small,
 * purposeful, time-boxed spaces are moderatable by one person; an open forum
 * for 16-19 year olds is not).
 *
 * Nothing here stores date of birth, school, town or postcode. The feature
 * works without them, so we do not ask for them. See docs/BUILD_PLAN.md.
 *
 * Publication flow: createPost -> screenPost (convex/moderation.ts) -> a row
 * with status `pending` -> a human in the moderation queue -> `visible`.
 */
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { currentUser, requireUser } from './users'
import { MAX_POST_CHARS, displayName, explainRefusal, screenPost } from './moderation'

/** Newest posts returned by a single feed read. */
const FEED_LIMIT = 100
const FEED_MAX = 200

/** Reasons are capped so a report cannot be used as a second posting surface. */
const MAX_REPORT_REASON_CHARS = 300

/**
 * Flood guard. Not a business limit - a cheap brake on someone spraying the
 * queue, which is a denial-of-service against the human reviewer and therefore
 * a safety problem rather than a cost problem.
 */
const POSTS_PER_HOUR = 10
const HOUR_MS = 60 * 60 * 1000

/**
 * Auto-approve is OFF unless COMMUNITY_AUTO_APPROVE is exactly "true".
 *
 * Turning it on means posts that trip NOTHING in screenPost publish without a
 * human seeing them first. Do not turn it on for an under-18 audience without
 * advice: screenPost is a regex triage filter, and "the regexes found nothing"
 * is not the same statement as "this is safe for a 16-year-old to read".
 * It exists so the switch is a documented, deliberate act rather than a code
 * change made in a hurry later.
 */
function autoApproveEnabled(): boolean {
  return (process.env.COMMUNITY_AUTO_APPROVE ?? '').toLowerCase() === 'true'
}

// ------------------------------------------------------------------ helpers

async function membership(ctx: QueryCtx | MutationCtx, cohortId: Id<'cohorts'>, userId: Id<'users'>) {
  return ctx.db
    .query('cohortMembers')
    .withIndex('by_cohort', (q) => q.eq('cohortId', cohortId))
    .filter((q) => q.eq(q.field('userId'), userId))
    .unique()
}

/**
 * Both directions of the block relation.
 *
 * "Who did I block" uses the by_user index. "Who blocked me" does not have an
 * index (the schema has by_user only, and schema.ts has one owner), so it is a
 * scan. That is acceptable while blocks are rare and a cohort is small, and it
 * is the right trade to make in the meantime: a block that only works one way
 * is not a block. If this table ever grows, ask the schema owner for a
 * by_blockedUser index and swap the second query for it.
 */
async function blockedUserIds(ctx: QueryCtx | MutationCtx, userId: Id<'users'>) {
  const [mine, theirs] = await Promise.all([
    ctx.db.query('blocks').withIndex('by_user', (q) => q.eq('userId', userId)).collect(),
    ctx.db.query('blocks').filter((q) => q.eq(q.field('blockedUserId'), userId)).collect(),
  ])
  const ids = new Set<string>()
  for (const b of mine) ids.add(b.blockedUserId)
  for (const b of theirs) ids.add(b.userId)
  return ids
}

// ------------------------------------------------------------------ cohorts

/**
 * Cohorts the viewer can see. Disabled cohorts are invisible to everyone,
 * always: `enabled` is the launch switch, and community must be deployable in
 * the off position.
 *
 * Signed-out callers get nothing. Community is not a public read surface - a
 * space for under-18s should not be crawlable, quotable or linkable from the
 * open web, and the cheapest way to guarantee that is never to serve it to
 * anyone who has not signed in.
 */
export const listCohorts = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return []

    const cohorts = (await ctx.db.query('cohorts').collect()).filter((c) => c.enabled)
    const memberships = await ctx.db
      .query('cohortMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    const joined = new Map(memberships.map((m) => [m.cohortId as string, m.joinedAt]))

    return cohorts
      .map((c) => ({
        _id: c._id,
        slug: c.slug,
        name: c.name,
        schemeId: c.schemeId,
        intakeYear: c.intakeYear,
        memberCount: c.memberCount,
        joined: joined.has(c._id),
        joinedAt: joined.get(c._id),
      }))
      .sort((a, b) => b.intakeYear - a.intakeYear || a.name.localeCompare(b.name))
  },
})

export const joinCohort = mutation({
  args: { cohortId: v.id('cohorts') },
  handler: async (ctx, { cohortId }) => {
    const user = await requireUser(ctx)
    const cohort = await ctx.db.get(cohortId)
    // Same error for missing and disabled: a disabled cohort should not be
    // discoverable by probing ids.
    if (!cohort || !cohort.enabled) throw new ConvexError('Not found')

    // Idempotent: a double-tapped join button must not inflate memberCount.
    const existing = await membership(ctx, cohortId, user._id)
    if (existing) return existing._id

    const id = await ctx.db.insert('cohortMembers', {
      cohortId,
      userId: user._id,
      joinedAt: Date.now(),
    })
    await ctx.db.patch(cohortId, { memberCount: cohort.memberCount + 1 })
    return id
  },
})

export const leaveCohort = mutation({
  args: { cohortId: v.id('cohorts') },
  handler: async (ctx, { cohortId }) => {
    const user = await requireUser(ctx)
    const existing = await membership(ctx, cohortId, user._id)
    // Leaving works even if the cohort has since been disabled: a user must
    // always be able to get out of a space, whatever state it is in.
    if (!existing) return null
    await ctx.db.delete(existing._id)

    const cohort = await ctx.db.get(cohortId)
    if (cohort) {
      // Clamped: a count that has drifted must not go negative and render as
      // "-1 members".
      await ctx.db.patch(cohortId, { memberCount: Math.max(0, cohort.memberCount - 1) })
    }
    // Posts are deliberately left in place. Leaving is not a delete-my-content
    // request; that is a separate, deliberate flow.
    return null
  },
})

// --------------------------------------------------------------------- feed

/**
 * The cohort feed, threaded one level deep by `replyToId`.
 *
 * What a viewer sees:
 *  - `visible` posts, minus anyone either side of a block;
 *  - their OWN `pending` posts, marked `awaitingReview`.
 *
 * That last one matters. A post that silently vanishes after you write it
 * reads as either a bug or a shadow-ban, and both drive people away. Showing
 * it back with "waiting to be checked" is honest about the moderation the
 * feature actually has.
 *
 * Non-members get an empty feed rather than a preview. Every reader in a
 * cohort is an accountable, joined member; there is no lurking.
 */
export const cohortFeed = query({
  args: { cohortId: v.id('cohorts'), limit: v.optional(v.number()) },
  handler: async (ctx, { cohortId, limit }) => {
    const user = await currentUser(ctx)
    if (!user) return { joined: false, enabled: false, posts: [] }

    const cohort = await ctx.db.get(cohortId)
    if (!cohort || !cohort.enabled) return { joined: false, enabled: false, posts: [] }

    const member = await membership(ctx, cohortId, user._id)
    if (!member) return { joined: false, enabled: true, posts: [] }

    const take = Math.min(Math.max(limit ?? FEED_LIMIT, 1), FEED_MAX)
    const recent = await ctx.db
      .query('posts')
      .withIndex('by_cohort', (q) => q.eq('cohortId', cohortId))
      .order('desc')
      .take(take)

    const blocked = await blockedUserIds(ctx, user._id)

    // A block hides in both directions: posts by people the viewer blocked,
    // and posts by people who blocked the viewer. One-directional blocking
    // leaves the blocked party able to keep watching, which is the situation
    // the block was meant to end.
    const readable = recent.filter((p) => {
      if (blocked.has(p.userId)) return false
      if (p.status === 'visible') return true
      if (p.status === 'pending') return p.userId === user._id
      return false // hidden and removed are gone for everyone, author included
    })

    const authors = new Map<string, Doc<'users'> | null>()
    for (const p of readable) {
      if (!authors.has(p.userId)) authors.set(p.userId, await ctx.db.get(p.userId))
    }

    const shape = (p: Doc<'posts'>) => ({
      _id: p._id,
      body: p.body,
      createdAt: p.createdAt,
      // Only ever a first name and an id. The id is here so the viewer can
      // block or report; the email address never leaves the users table.
      author: { id: p.userId, name: displayName(authors.get(p.userId)?.name) },
      isMine: p.userId === user._id,
      awaitingReview: p.status === 'pending',
      status: p.status,
    })

    const byId = new Set(readable.map((p) => p._id as string))
    const roots = readable.filter((p) => !p.replyToId).sort((a, b) => a.createdAt - b.createdAt)
    // A reply whose parent is not in the readable set is dropped rather than
    // promoted to a root. Half a conversation reads as broken, and showing a
    // reply to a blocked or removed post leaks the thing that was taken away.
    const replies = readable.filter((p) => p.replyToId && byId.has(p.replyToId as string))

    return {
      joined: true,
      enabled: true,
      cohort: { _id: cohort._id, name: cohort.name, intakeYear: cohort.intakeYear },
      posts: roots.map((root) => ({
        ...shape(root),
        replies: replies
          .filter((r) => r.replyToId === root._id)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(shape),
      })),
    }
  },
})

// -------------------------------------------------------------------- posts

/**
 * Write a post.
 *
 * Order of enforcement, all server-side: cohort exists and is enabled -> the
 * author is a member -> flood guard -> length -> screening -> insert.
 *
 * The insert is `pending`. It is only ever `visible` when screening came back
 * completely clean AND the documented auto-approve flag is on, which it is not
 * by default. Publication is a decision a human makes.
 */
export const createPost = mutation({
  args: {
    cohortId: v.id('cohorts'),
    body: v.string(),
    replyToId: v.optional(v.id('posts')),
  },
  handler: async (ctx, { cohortId, body, replyToId }) => {
    const user = await requireUser(ctx)

    const cohort = await ctx.db.get(cohortId)
    if (!cohort || !cohort.enabled) throw new ConvexError('This cohort is not open')

    const member = await membership(ctx, cohortId, user._id)
    if (!member) throw new ConvexError('Join the cohort before posting')

    const text = body.trim()
    if (!text) throw new ConvexError('Write something first')
    if (text.length > MAX_POST_CHARS) {
      throw new ConvexError(`Keep it under ${MAX_POST_CHARS} characters.`)
    }

    const since = Date.now() - HOUR_MS
    const recent = await ctx.db
      .query('posts')
      .withIndex('by_user', (q) => q.eq('userId', user._id).gte('createdAt', since))
      .collect()
    if (recent.length >= POSTS_PER_HOUR) {
      throw new ConvexError("You've posted a lot in the last hour. Give it a bit and come back.")
    }

    if (replyToId) {
      const parent = await ctx.db.get(replyToId)
      // Replies only attach to a published post in the same cohort: no
      // replying to something still in the queue, and no cross-posting a
      // thread out of the cohort it belongs to.
      if (!parent || parent.cohortId !== cohortId || parent.status !== 'visible') {
        throw new ConvexError('That post is no longer available')
      }
      if (parent.replyToId) throw new ConvexError('You can only reply to a top-level post')
    }

    // Cheap pre-publication triage. This routes; it does not clear.
    const screening = screenPost(text)
    if (screening.verdict === 'block') {
      // Refused at the door and nothing is stored, so the author can fix it and
      // repost. screenPost never returns 'block' for a post that looks like
      // distress - see the override there.
      throw new ConvexError(explainRefusal(screening.reasons))
    }

    const status = screening.verdict === 'allow' && autoApproveEnabled() ? 'visible' : 'pending'

    const id = await ctx.db.insert('posts', {
      cohortId,
      userId: user._id,
      body: text,
      replyToId,
      status,
      createdAt: Date.now(),
    })
    // The screening reasons are NOT stored on the row. The queue re-runs
    // screenPost when it renders, so improving the filter improves the backlog
    // instead of leaving stale verdicts behind.
    return { id, status, awaitingReview: status === 'pending' }
  },
})

/**
 * Report a post. Any member of the cohort can report anything in it, including
 * their own post (a retraction is a legitimate use).
 *
 * Idempotent per user per post: reporting twice does not stack the queue, and
 * the reporter still gets a success rather than an error telling them off for
 * caring twice.
 */
export const reportPost = mutation({
  args: { postId: v.id('posts'), reason: v.string() },
  handler: async (ctx, { postId, reason }) => {
    const user = await requireUser(ctx)
    const post = await ctx.db.get(postId)
    if (!post) throw new ConvexError('Not found')

    const member = await membership(ctx, post.cohortId, user._id)
    if (!member) throw new ConvexError('Not found')

    const existing = await ctx.db
      .query('reports')
      .withIndex('by_post', (q) => q.eq('postId', postId))
      .filter((q) => q.eq(q.field('reporterId'), user._id))
      .first()
    if (existing) return existing._id

    return ctx.db.insert('reports', {
      postId,
      reporterId: user._id,
      reason: reason.trim().slice(0, MAX_REPORT_REASON_CHARS) || 'No reason given',
      createdAt: Date.now(),
    })
  },
})

// ------------------------------------------------------------------- blocks

/**
 * Block someone. Takes effect immediately and in both directions of the feed
 * (see blockedUserIds), and needs no reason and no moderator involvement -
 * making a young person justify wanting someone gone is a reason not to do it.
 */
export const blockUser = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await requireUser(ctx)
    if (userId === user._id) throw new ConvexError("You can't block yourself")
    const target = await ctx.db.get(userId)
    if (!target) throw new ConvexError('Not found')

    const existing = await ctx.db
      .query('blocks')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .filter((q) => q.eq(q.field('blockedUserId'), userId))
      .first()
    if (existing) return existing._id

    return ctx.db.insert('blocks', { userId: user._id, blockedUserId: userId, createdAt: Date.now() })
  },
})

export const unblockUser = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db
      .query('blocks')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .filter((q) => q.eq(q.field('blockedUserId'), userId))
      .first()
    if (existing) await ctx.db.delete(existing._id)
    return null
  },
})

/** Needed by the UI: a block you cannot see is a block you cannot undo. */
export const listBlocks = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const rows = await ctx.db
      .query('blocks')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    const out = []
    for (const b of rows) {
      const target = await ctx.db.get(b.blockedUserId)
      out.push({ _id: b._id, userId: b.blockedUserId, name: displayName(target?.name), createdAt: b.createdAt })
    }
    return out
  },
})

// ------------------------------------------------------- operator functions

/**
 * Cohort creation is an operator action, not a user action: users cannot mint
 * spaces. Internal, so it is reachable only from the Convex CLI or another
 * server function:
 *
 *   npx convex run community:createCohort '{"slug":"rr-degree-2026", ...}'
 *
 * `enabled` is hard-coded false and is not an argument. Every cohort ships in
 * the off position and is turned on deliberately, by a separate call, once a
 * named human is actually watching the queue.
 */
export const createCohort = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    schemeId: v.optional(v.id('schemes')),
    intakeYear: v.number(),
  },
  handler: async (ctx, { slug, name, schemeId, intakeYear }) => {
    const existing = await ctx.db.query('cohorts').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
    if (existing) throw new ConvexError(`Cohort ${slug} already exists`)
    return ctx.db.insert('cohorts', {
      slug,
      name,
      schemeId,
      intakeYear,
      memberCount: 0,
      enabled: false,
      createdAt: Date.now(),
    })
  },
})

/**
 * The launch switch, and the one lever that opens a space to under-18s.
 * Internal and deliberately separate from creation so that turning community
 * on is its own decision with its own moment:
 *
 *   npx convex run community:setCohortEnabled '{"slug":"...","enabled":true}'
 *
 * Do not call this with `true` until COMMUNITY_MODERATORS names a real person
 * who is actually working the queue, and until the advice in
 * docs/BUILD_PLAN.md has been taken.
 */
export const setCohortEnabled = internalMutation({
  args: { slug: v.string(), enabled: v.boolean() },
  handler: async (ctx, { slug, enabled }) => {
    const cohort = await ctx.db.query('cohorts').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
    if (!cohort) throw new ConvexError(`No cohort ${slug}`)
    await ctx.db.patch(cohort._id, { enabled })
    return { slug, enabled }
  },
})
