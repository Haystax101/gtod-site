/**
 * Community moderation: the cheap pre-publication filter, the human queue, and
 * the report list.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE
 *
 * `screenPost` is a TRIAGE FILTER. It is not a safety classifier, it is not a
 * content moderation system, and it is emphatically NOT a substitute for a
 * named human being who owns the queue and looks at every post before it is
 * published. Its entire job is to decide how urgently a human should look at
 * something. It will have false positives (a legitimate gov.uk link) and it
 * will have false negatives (anything a determined adult phrases carefully).
 * Both are expected. The human is the control; this is the pre-sort.
 *
 * The audience is 16-19. That puts this feature in scope for the UK Children's
 * code and for the Online Safety Act's user-to-user duties. Two consequences
 * are baked into the code and must not be "optimised" away:
 *
 *   1. Posts are inserted as `pending`. Publication is a decision a person
 *      makes. Auto-approval exists behind an env flag that defaults to OFF and
 *      only ever applies to posts this filter found nothing at all in.
 *   2. Every cohort ships with `enabled: false`. Community can be deployed in
 *      the off position, and that is the default.
 *
 * DO NOT OPEN COMMUNITY TO UNDER-18s WITHOUT TAKING ACTUAL LEGAL AND
 * SAFEGUARDING ADVICE. See docs/BUILD_PLAN.md, compliance section.
 * ---------------------------------------------------------------------------
 */
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { requireUser } from './users'

// ------------------------------------------------------------------ limits

/**
 * Hard ceiling on a post. Above this the post is refused at the door rather
 * than queued: nothing a 17-year-old needs to say to a cohort takes 2,000
 * characters, and walls of pasted text are where copied chat logs, whole
 * personal statements and full contact blocks turn up.
 */
export const MAX_POST_CHARS = 2000

/**
 * Soft ceiling. Long-but-legal posts still go to a human, they just are not
 * refused. Length on its own is weak signal, so it only ever means "review".
 */
export const LONG_POST_CHARS = 1200

// ------------------------------------------------------------- the verdict

export type Verdict = 'allow' | 'review' | 'block'

export interface ScreenResult {
  /**
   * allow  - nothing tripped. Still only publishes if auto-approve is on.
   * review - a human decides. This is the normal outcome and the safe one.
   * block  - refuse at the door and tell the author why, so the queue keeps
   *          the reviewer's attention for genuine judgement calls.
   */
  verdict: Verdict
  /** Stable slugs, so the UI and the queue can render them consistently. */
  reasons: string[]
}

// Reasons in the order we want a reviewer to read them: safeguarding first,
// then the grooming-adjacent signals, then noise.
const REASON_ORDER = [
  'possible-safeguarding-concern',
  'phone-number',
  'email-address',
  'social-handle',
  'private-messaging-invite',
  'contact-platform-mention',
  'sexual-content',
  'severe-language',
  'profanity',
  'external-link',
  'over-length',
  'unusually-long',
]

// ------------------------------------------------------------- the patterns

/**
 * Phone numbers. Deliberately anchored on a leading 0 or +44, or on an
 * unbroken 10-15 digit run, because the naive "any long digit sequence"
 * version flags "2024 2025 2026" and salary ranges, and a filter that cries
 * wolf on every intake-year post trains the reviewer to stop reading.
 */
const PHONE_PATTERNS = [
  /(?:\+\s?4\s?4|\b0)[\d\s().-]{8,14}\d/,
  /\b\d{10,15}\b/,
]

/**
 * Emails, plain and lightly obfuscated. The "at"/"dot" word forms require BOTH
 * words, so "look at gov.uk" is not read as an address.
 */
const EMAIL_PATTERNS = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  /[a-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\bat\b)\s*[a-z0-9.-]+\s*(?:\(dot\)|\[dot\]|\bdot\b)\s*[a-z]{2,}/i,
]

/** An @handle. Three characters minimum so an "@" used as "at" is ignored. */
const HANDLE_PATTERN = /(?:^|\s)@[a-z0-9._]{3,30}\b/i

/**
 * Named platforms. Mentioning one is not misconduct, but "which platform" is
 * the step before "let's talk there", and there is no cost to a human glancing
 * at it. Bare "pm" is excluded on purpose: "the deadline is 5 pm".
 */
const PLATFORM_PATTERN =
  /\b(?:insta|instagram|snapchat|snap|tiktok|discord|whatsapp|telegram|kik|dms?|facebook|messenger|signal)\b/i

/**
 * Invitations to move the conversation somewhere unobserved. This is the
 * single most important check in the file. A request to move off a moderated
 * space and into private messaging is the textbook first move in grooming, and
 * it looks completely innocent in isolation - which is exactly why it routes
 * to a human rather than being scored as harmless.
 */
const PRIVATE_INVITE_PATTERNS = [
  /\b(?:dm|pm|message|msg|text|call|whatsapp|snap|add|email)\s+me\b/i,
  /\bhit me up\b/i,
  /\badd me on\b/i,
  /\bmy (?:snap|insta|instagram|discord|number|email|username|handle)\b/i,
  /\blet'?s (?:talk|chat|move|take this)\b[^.!?]{0,20}\b(?:privately|private|off ?here|elsewhere|there)\b/i,
  /\bprivate(?:ly)? messag/i,
  /\b(?:off|away from) ?(?:here|this app|the app)\b/i,
  /\bgroup chat\b/i,
]

/**
 * Links. Even a legitimate link goes to a human: shorteners hide their
 * destination, and "here's the application portal" is indistinguishable from
 * "here's my server" to a regex.
 */
const LINK_PATTERNS = [
  /(?:https?:\/\/|www\.)\S+/i,
  /\b[a-z0-9-]+\.(?:com|co\.uk|org|net|io|me|ly|gg|xyz|link|app|uk)\b/i,
  /\bdot\s?(?:com|co ?uk|net|org)\b/i,
]

/**
 * Obvious profanity only. This list is shallow by design - it is not trying to
 * be a swearing detector, and a stressed applicant saying a rejection was
 * "shit" is not a safety incident. It routes to a human and stops there.
 */
const PROFANITY = [
  'fuck', 'fucking', 'fucked', 'shit', 'bullshit', 'bitch', 'bastard',
  'wanker', 'twat', 'prick', 'dickhead', 'bollocks', 'arsehole', 'slag',
]

/**
 * Slurs and targeted abuse. Refused at the door: there is no version of these
 * that a reviewer would approve, and making a person read them one at a time
 * in a queue is its own harm. The post is not stored, so the author is told
 * plainly and can rewrite.
 */
const SEVERE = ['cunt', 'nigg', 'paki', 'faggot', 'tranny', 'retard', 'kys', 'kill yourself']

/** Sexual solicitation. Also refused at the door. */
const SEXUAL = ['nudes', 'send pics', 'send me pics', 'sexting', 'horny', 'hook up', 'hookup']

/**
 * Distress. This exists so that a post from someone in trouble is guaranteed
 * to reach a human, and is NEVER bounced back at them by an automated rule -
 * see the override in screenPost. A rejection at 17 genuinely does hurt, most
 * of these posts need nothing more than a reply, and the point is that a
 * person makes that call.
 */
const SAFEGUARDING = [
  'kill myself', 'killing myself', 'kms', 'end it all', 'want to die',
  'suicide', 'suicidal', 'self harm', 'self-harm', 'cutting myself',
  'hurt myself', 'starve myself', 'hate myself', 'no point living',
]

// --------------------------------------------------------------- the filter

/**
 * Normalise before matching: NFKC folds full-width and lookalike characters,
 * zero-width characters are stripped (they are used to break word matching),
 * and a few leetspeak substitutions are applied. This is a speed bump, not
 * armour - anyone who wants past it gets past it, and the human is the control.
 */
function normalise(body: string): string {
  return body
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/@/g, 'a')
}

function containsWord(haystack: string, needle: string): boolean {
  // Word-boundary match so "scunthorpe" and "classic" survive. Multi-word
  // needles are matched as phrases.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${escaped}`, 'i').test(haystack)
}

/**
 * Cheap pre-publication screening. PURE: no database, no network, no clock, no
 * randomness, so it is unit-testable and gives the same answer in the mutation
 * and later in the moderation queue.
 *
 * It answers exactly one question: how urgently does a human need to look at
 * this? It does not decide whether the post is safe. Nothing here should ever
 * be presented to a user, or to GTOD, as a safety guarantee.
 */
export function screenPost(body: string): ScreenResult {
  const raw = (body ?? '').trim()
  const text = normalise(raw)
  const reasons = new Set<string>()
  let blocked = false

  // Length. The hard cap is refused; the soft cap is only a nudge to a human.
  if (raw.length > MAX_POST_CHARS) {
    reasons.add('over-length')
    blocked = true
  } else if (raw.length > LONG_POST_CHARS) {
    reasons.add('unusually-long')
  }

  // Contact details. All of these route to review, never to allow, even when
  // the surrounding post is completely innocent - because that is precisely
  // what a grooming approach looks like from the outside.
  if (PHONE_PATTERNS.some((re) => re.test(raw))) reasons.add('phone-number')
  if (EMAIL_PATTERNS.some((re) => re.test(raw))) reasons.add('email-address')
  if (HANDLE_PATTERN.test(raw)) reasons.add('social-handle')
  if (PRIVATE_INVITE_PATTERNS.some((re) => re.test(raw))) reasons.add('private-messaging-invite')
  if (PLATFORM_PATTERN.test(raw)) reasons.add('contact-platform-mention')
  if (LINK_PATTERNS.some((re) => re.test(raw))) reasons.add('external-link')

  // Language.
  if (SEVERE.some((w) => containsWord(text, w))) {
    reasons.add('severe-language')
    blocked = true
  }
  if (SEXUAL.some((w) => containsWord(text, w))) {
    reasons.add('sexual-content')
    blocked = true
  }
  if (PROFANITY.some((w) => containsWord(text, w))) reasons.add('profanity')

  // Safeguarding, checked last so it can override everything below it.
  const safeguarding = SAFEGUARDING.some((w) => containsWord(text, w))
  if (safeguarding) reasons.add('possible-safeguarding-concern')

  const ordered = REASON_ORDER.filter((r) => reasons.has(r))

  // A post from someone in distress is NEVER refused, whatever else is in it.
  // Bouncing "I want to die" back at a teenager with an automated error is the
  // worst thing this file could do; it goes to a person, at the top of the
  // queue. This override is deliberate - do not "simplify" it away.
  if (safeguarding) return { verdict: 'review', reasons: ordered }

  if (blocked) return { verdict: 'block', reasons: ordered }
  if (ordered.length) return { verdict: 'review', reasons: ordered }
  return { verdict: 'allow', reasons: [] }
}

/** Plain English for the author when a post is refused at the door. */
export function explainRefusal(reasons: string[]): string {
  const parts: string[] = []
  if (reasons.includes('over-length')) parts.push(`keep it under ${MAX_POST_CHARS} characters`)
  if (reasons.includes('severe-language')) parts.push('drop the abusive language')
  if (reasons.includes('sexual-content')) parts.push('keep it about apprenticeships')
  return parts.length
    ? `We can't post that. Please ${parts.join(', and ')}, then try again.`
    : "We can't post that. Please rewrite it and try again."
}

/**
 * First name only, and never the email address. The feed needs enough to hold
 * a conversation and nothing more - data minimisation applies to what we show
 * as well as to what we store.
 */
export function displayName(name?: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? first.slice(0, 24) : 'Member'
}

// ------------------------------------------------------- the human reviewer

/**
 * Moderators are named in an environment variable rather than a database flag,
 * so becoming a moderator is a deployment action by whoever holds the Convex
 * credentials, not something reachable from the app.
 *
 * Set COMMUNITY_MODERATORS to a comma-separated list of Clerk user ids or
 * email addresses. With it unset NOBODY can open the queue - which is the
 * correct failure mode, because a community with an unread queue should not be
 * open. The build plan's "a named human must own the moderation queue" is
 * enforced here, in code.
 */
function moderatorList(): string[] {
  return (process.env.COMMUNITY_MODERATORS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

async function requireModerator(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx)
  const allowed = moderatorList()
  if (!allowed.length) {
    throw new ConvexError(
      'No moderator is configured. Set COMMUNITY_MODERATORS before opening the queue.',
    )
  }
  const identities = [user.clerkId.toLowerCase(), (user.email ?? '').toLowerCase()].filter(Boolean)
  if (!identities.some((id) => allowed.includes(id))) throw new ConvexError('Not found')
  return user
}

/** Who to record against a decision. An audit trail needs a person, not a role. */
function moderatorLabel(user: { email?: string; clerkId: string }): string {
  return user.email ?? user.clerkId
}

// ------------------------------------------------------------------ queries

/**
 * The pending queue, oldest first. FIFO matters: a queue worked newest-first
 * leaves the unlucky post at the bottom forever, and a post stuck in review is
 * indistinguishable from being ignored by the person who wrote it.
 */
export const moderationQueue = query({
  args: { cohortId: v.optional(v.id('cohorts')), limit: v.optional(v.number()) },
  handler: async (ctx, { cohortId, limit }) => {
    await requireModerator(ctx)
    const take = Math.min(Math.max(limit ?? 50, 1), 100)
    const pending = await ctx.db
      .query('posts')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .order('asc')
      .take(cohortId ? take * 4 : take)

    const rows = (cohortId ? pending.filter((p) => p.cohortId === cohortId) : pending).slice(0, take)

    const out = []
    for (const post of rows) {
      const [author, cohort, reports] = await Promise.all([
        ctx.db.get(post.userId),
        ctx.db.get(post.cohortId),
        ctx.db.query('reports').withIndex('by_post', (q) => q.eq('postId', post._id)).collect(),
      ])
      // Re-screened here rather than read back from a stored field, so that
      // improving the filter improves the queue for posts already waiting.
      const screening = screenPost(post.body)
      out.push({
        _id: post._id,
        cohortId: post.cohortId,
        cohortName: cohort?.name ?? 'Unknown cohort',
        body: post.body,
        isReply: Boolean(post.replyToId),
        createdAt: post.createdAt,
        author: { id: post.userId, name: displayName(author?.name) },
        screening,
        reportCount: reports.length,
        // Surfaced so the reviewer can triage: distress first, then the
        // grooming-adjacent signals, then everything else.
        priority: screening.reasons.includes('possible-safeguarding-concern')
          ? 'urgent'
          : screening.reasons.length || reports.length
            ? 'flagged'
            : 'normal',
      })
    }
    // Urgent first, then flagged, then oldest-first within each band.
    const rank = { urgent: 0, flagged: 1, normal: 2 } as const
    return out.sort(
      (a, b) =>
        rank[a.priority as keyof typeof rank] - rank[b.priority as keyof typeof rank] ||
        a.createdAt - b.createdAt,
    )
  },
})

/** Reports nobody has closed yet, oldest first, with enough context to act. */
export const unresolvedReports = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireModerator(ctx)
    const take = Math.min(Math.max(limit ?? 50, 1), 100)
    const reports = await ctx.db
      .query('reports')
      .withIndex('by_unresolved', (q) => q.eq('resolvedAt', undefined))
      .order('asc')
      .take(take)

    const out = []
    for (const report of reports) {
      const post = await ctx.db.get(report.postId)
      const [author, cohort, reporter] = await Promise.all([
        post ? ctx.db.get(post.userId) : null,
        post ? ctx.db.get(post.cohortId) : null,
        ctx.db.get(report.reporterId),
      ])
      out.push({
        _id: report._id,
        postId: report.postId,
        reason: report.reason,
        createdAt: report.createdAt,
        // The reporter is named to the moderator only. A 17-year-old will not
        // report a peer if the peer finds out who did it.
        reporter: { id: report.reporterId, name: displayName(reporter?.name) },
        post: post
          ? {
              body: post.body,
              status: post.status,
              cohortName: cohort?.name ?? 'Unknown cohort',
              author: { id: post.userId, name: displayName(author?.name) },
              screening: screenPost(post.body),
            }
          : null,
      })
    }
    return out
  },
})

// ---------------------------------------------------------------- decisions

/**
 * A human decides. `approve` publishes, `hide` pulls it from the feed but
 * keeps it, `remove` marks a policy breach.
 *
 * Nothing here deletes a row. A removed post stays in the table with the
 * decision, the reviewer and the note attached, because deleting the record of
 * a safeguarding incident is the wrong instinct: the audit trail is the thing
 * you need if it ever has to be explained to a parent, a school or the ICO.
 */
export const resolvePost = mutation({
  args: {
    postId: v.id('posts'),
    action: v.union(v.literal('approve'), v.literal('hide'), v.literal('remove')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { postId, action, note }) => {
    const moderator = await requireModerator(ctx)
    const post = await ctx.db.get(postId)
    if (!post) throw new ConvexError('Not found')

    const status = action === 'approve' ? 'visible' : action === 'hide' ? 'hidden' : 'removed'
    const now = Date.now()
    await ctx.db.patch(postId, {
      status,
      moderatedBy: moderatorLabel(moderator),
      moderatedAt: now,
      moderationNote: note?.trim().slice(0, 500) || undefined,
    })

    // A decision on the post closes the reports about it: leaving them open
    // means the reports list stops being a to-do list and starts being noise.
    const reports = await ctx.db
      .query('reports')
      .withIndex('by_post', (q) => q.eq('postId', postId))
      .collect()
    for (const report of reports) {
      if (!report.resolvedAt) await ctx.db.patch(report._id, { resolvedAt: now })
    }

    return { status, reportsClosed: reports.filter((r) => !r.resolvedAt).length }
  },
})
