/**
 * The application timeline: the scheme directory, what a user is tracking, and
 * the weekly task list generated from it.
 *
 * The product bet is in `tasksFor()` below. Every competitor lists deadlines;
 * none of them join a deadline to a person and tell them what to do about it
 * this week. That function is the whole feature, so it is a pure function of
 * (application, scheme, now) with no database access - it can be read, argued
 * with and unit tested on its own (`tools/timeline/rules.test.ts`).
 *
 * Two rules run through all of it:
 *
 * 1. Never show a date we have not checked. An unverified `closesAt` from the
 *    seed directory never drives a task or a countdown (see
 *    `effectiveDeadline`). Only a date the user typed, or one a human has
 *    verified against the employer's page, is allowed to create urgency.
 * 2. Titles are actions a 17-year-old can do this week. "Book your Deloitte
 *    online test", never "Progress your application".
 */
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { currentUser, requireUser } from './users'
import { SCHEME_SEEDS } from './content/schemes'

export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

/** Everything a week's worth of tasks is keyed on lives in this one helper. */
export function weekOf(ts: number = Date.now()): string {
  const d = new Date(ts)
  d.setUTCHours(0, 0, 0, 0)
  // getUTCDay is 0 for Sunday; shift so Monday is 0, because a UK application
  // week starts on Monday and "what am I doing this week" means Monday to Sunday.
  const sinceMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - sinceMonday)
  return d.toISOString().slice(0, 10)
}

/** Milliseconds at 00:00 UTC on the Monday of the week containing `ts`. */
export function weekStart(ts: number = Date.now()): number {
  return Date.parse(`${weekOf(ts)}T00:00:00.000Z`)
}

/** ISO week string N weeks before the one containing `ts`. */
function weekOffset(ts: number, weeks: number): string {
  return weekOf(weekStart(ts) + weeks * WEEK_MS)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "14 Nov". Hand-rolled rather than Intl so the string is identical in the
 * Convex runtime, in Node and in a test, whatever the machine's locale is.
 */
export function formatDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * Whole days from `now` until `ts`. Rounded down, so a deadline eight hours
 * away is 0 days ("today") rather than 1 - erring towards urgency is the safe
 * direction when the cost of being late is losing a year.
 */
export function daysUntil(ts: number, now: number): number {
  return Math.floor((ts - now) / DAY_MS)
}

// ------------------------------------------------------------- the rules

export type ApplicationStage = Doc<'applications'>['stage']

/** The shape `tasksFor` needs. Structural, so tests need no database. */
export interface ApplicationLike {
  stage: ApplicationStage
  deadlineAt?: number
  customEmployer?: string
  customName?: string
  createdAt: number
  /** Last change to the row. Used as a proxy for "how long stuck at this stage". */
  updatedAt: number
}

export interface SchemeLike {
  employer: string
  name: string
  closesAt?: number
  rolling?: boolean
  verified: boolean
}

export interface TaskDraft {
  title: string
  detail?: string
  dueAt?: number
  /**
   * `once`   - do it once per application and never nag again (research, setup).
   * `weekly` - regenerate every week the rule still applies (practice, chasing,
   *            anything with a deadline behind it).
   *
   * The generator enforces this: `once` drafts are dropped if a task with the
   * same title exists for this application in the recent history window,
   * `weekly` drafts only if one exists in the current week.
   */
  repeat: 'once' | 'weekly'
}

/** Stages where the application is over and generating work would be cruel. */
export function isClosed(stage: ApplicationStage): boolean {
  return stage === 'rejected' || stage === 'withdrawn'
}

/** What we call the employer in a task title. Never "this employer" if avoidable. */
export function employerLabel(application: ApplicationLike, scheme: SchemeLike | null): string {
  return scheme?.employer ?? application.customEmployer ?? 'this employer'
}

/**
 * The deadline we are allowed to act on.
 *
 * The user's own date always wins - they may have read a closing date off the
 * page we have not checked yet, and they are the one being marked late. A
 * scheme's `closesAt` is used only when a human has verified the row; an
 * unverified seed date must never generate urgency, because a wrong deadline is
 * worse for a user than no deadline at all.
 */
export function effectiveDeadline(
  application: ApplicationLike,
  scheme: SchemeLike | null,
): number | undefined {
  if (application.deadlineAt !== undefined) return application.deadlineAt
  if (scheme?.verified && scheme.closesAt !== undefined) return scheme.closesAt
  return undefined
}

/**
 * The tasks that matter this week for one application.
 *
 * Returned in priority order - most urgent first - because the caller caps how
 * many tasks a single application may contribute to a week. A user tracking ten
 * schemes must not open the app to sixty todos; they will close it and not
 * come back.
 *
 * The rules, in one place:
 *
 *   Deadline distance (pre-submission stages only, because after you have
 *   submitted the closing date is no longer yours to hit)
 *     passed        chase the truth: is it actually closed?
 *     0-3 days      submit now, dated
 *     4-7 days      submit this week, dated
 *     8-21 days     draft it (the "three weeks out" case)
 *     22+ days      diarise it, once
 *     unknown       go and find the closing date
 *
 *   Stage
 *     interested          research the scheme, decide, don't drift
 *     applying            tailor the CV, write the answers, submit
 *     submitted           bank the answers, watch for the reply, chase if silent
 *     online_test         book it, practise it, sit it
 *     video_interview     record yourself, check the kit, prepare examples
 *     assessment_centre   find out the format, prepare the group and case work
 *     final_interview     rehearse out loud, prepare questions to ask
 *     offer               check the terms and reply
 *     rejected/withdrawn  nothing (the rejection debrief owns that moment)
 *
 *   Staleness (from `updatedAt`, the last time anything about the row changed)
 *     interested 21+ days with no deadline   force a decision
 *     submitted  28+ days                    chase for an update
 */
export function tasksFor(
  application: ApplicationLike,
  scheme: SchemeLike | null,
  now: number,
): TaskDraft[] {
  if (isClosed(application.stage)) return []

  const who = employerLabel(application, scheme)
  const deadline = effectiveDeadline(application, scheme)
  const days = deadline === undefined ? undefined : daysUntil(deadline, now)
  const stageAgeDays = Math.floor((now - application.updatedAt) / DAY_MS)
  const drafts: TaskDraft[] = []

  const preSubmission = application.stage === 'interested' || application.stage === 'applying'

  // ---- deadline pressure, before anything else -------------------------
  // Only while the deadline is still the user's problem. Once an application is
  // in, the closing date is irrelevant and repeating it is just anxiety.
  if (preSubmission && deadline !== undefined && days !== undefined) {
    if (days < 0) {
      drafts.push({
        title: `Check whether ${who} is still accepting applications`,
        detail: `The deadline you saved has passed. Open their page: if it has closed, mark this withdrawn and put your time somewhere live. If it is still open, fix the date here.`,
        repeat: 'weekly',
      })
    } else if (days <= 3) {
      const when = days === 0 ? 'today' : days === 1 ? 'by tomorrow' : `in ${days} days`
      drafts.push({
        title: `Submit your ${who} application ${when}`,
        detail: `It closes ${formatDay(deadline)}. Submitted and imperfect beats perfect and late - employers cannot score an application that is not there.`,
        dueAt: deadline,
        repeat: 'weekly',
      })
    } else if (days <= 7) {
      drafts.push({
        title: `Submit your ${who} application this week`,
        detail: `It closes ${formatDay(deadline)}, which is ${days} days away. Leave yourself a day spare in case the form crashes or asks for a reference.`,
        dueAt: deadline,
        repeat: 'weekly',
      })
    } else if (days <= 21) {
      // The "three weeks out" case from the brief: near enough to start, far
      // enough that the job this week is a draft rather than a submission.
      drafts.push({
        title: `Draft your application for ${who}`,
        detail: `It closes ${formatDay(deadline)}. Get a rough version of every answer down this week - you can improve it next week, but you cannot improve nothing.`,
        repeat: 'weekly',
      })
    } else {
      drafts.push({
        title: `Put ${who}'s ${formatDay(deadline)} deadline in your phone calendar`,
        detail: `Set the alert for two weeks before, not the day itself.`,
        repeat: 'once',
      })
    }
  }

  // A date nobody has is the most common state of this table, and finding it is
  // a real, small, doable task - so it becomes one.
  if (preSubmission && deadline === undefined) {
    if (scheme?.rolling) {
      drafts.push({
        title: `Apply to ${who} now - they recruit all year and close when full`,
        detail: `Rolling schemes do not wait for a deadline. The places go to whoever applies first and is good enough.`,
        repeat: 'once',
      })
    } else {
      drafts.push({
        title: `Find ${who}'s closing date and add it to your timeline`,
        detail: scheme
          ? `It is on their careers page: ${scheme.name}. Once it is in here you will get reminders as it gets close.`
          : `Check their careers page, then add the date here so you get reminders as it gets close.`,
        repeat: 'once',
      })
    }
  }

  // ---- stage-specific work ---------------------------------------------
  switch (application.stage) {
    case 'interested': {
      drafts.push({
        title: `Read ${who}'s scheme page and write down the entry requirements`,
        detail: `Grades, location, start date, and whether they take your subjects. Ten minutes now saves you an application you were never eligible for.`,
        repeat: 'once',
      })
      // Drifting at "interested" for three weeks with no deadline in sight is
      // the commonest way a scheme quietly gets missed. Force the decision.
      if (deadline === undefined && stageAgeDays >= 21) {
        drafts.push({
          title: `Decide this week: apply to ${who}, or take it off your list`,
          detail: `It has sat here three weeks without moving. Either is a fine answer - leaving it undecided is not.`,
          repeat: 'weekly',
        })
      }
      break
    }

    case 'applying': {
      drafts.push({
        title: `Tailor your CV to ${who}'s job description`,
        detail: `Pull the keywords out of their description and get them into your CV in your own words. Most first-round sifts are automated.`,
        repeat: 'once',
      })
      drafts.push({
        title: `Write your "why ${who}?" answer`,
        detail: `Name something specific about them - a project, a value, a team - and connect it to something you have actually done.`,
        repeat: 'once',
      })
      if (days === undefined || days > 7) {
        // No deadline pressure yet, so the weekly job is simply momentum.
        drafts.push({
          title: `Finish one more section of your ${who} application`,
          detail: `One section a week finishes an application. Waiting for a free evening does not.`,
          repeat: 'weekly',
        })
      }
      drafts.push({
        title: `Get someone to read your ${who} application before you send it`,
        detail: `A teacher, a parent, anyone. You cannot see your own typos by week two.`,
        repeat: 'once',
      })
      break
    }

    case 'submitted': {
      drafts.push({
        title: `Save your ${who} answers to your answer bank`,
        detail: `Copy them across while they are fresh. Half of them will be reusable on the next application, and rewriting from scratch every time is how people burn out in October.`,
        repeat: 'once',
      })
      if (stageAgeDays >= 14) {
        drafts.push({
          title: `Check your junk folder for a reply from ${who}`,
          detail: `Assessment invitations get filtered constantly, and they usually have a deadline on them.`,
          repeat: 'once',
        })
      }
      if (stageAgeDays >= 28) {
        drafts.push({
          title: `Email ${who}'s early careers team for an update`,
          detail: `Four weeks of silence is worth one polite email. Short: your name, the scheme, when you applied, asking about timelines.`,
          repeat: 'weekly',
        })
      }
      break
    }

    case 'online_test': {
      // The window between invitation and test is usually days, not weeks, and
      // it is where most people lose their place. Booking it comes first.
      drafts.push({
        title: `Book your ${who} online test`,
        detail: `Pick a slot when you are actually awake, and do it on a laptop with a wired-in charger.`,
        dueAt: deadline,
        repeat: 'once',
      })
      if (deadline !== undefined && days !== undefined && days >= 0 && days <= 7) {
        drafts.push({
          title: `Sit your ${who} online test before ${formatDay(deadline)}`,
          detail: `Invitations expire. Missing the window counts as a withdrawal, not a delay.`,
          dueAt: deadline,
          repeat: 'weekly',
        })
      }
      drafts.push({
        title: `Practise numerical reasoning before ${who}'s test`,
        detail: `Thirty minutes, timed, with a calculator and rough paper. Free practice sets: the National Careers Service, and psychometrictests.org.`,
        repeat: 'weekly',
      })
      drafts.push({
        title: `Do one situational judgement practice set for ${who}`,
        detail: `These are scored against the employer's values, so read their values page first and answer as that company, not as yourself on a bad day.`,
        repeat: 'once',
      })
      break
    }

    case 'video_interview': {
      drafts.push({
        title: `Record yourself answering "why ${who}?" and watch it back`,
        detail: `On your phone, once. Watching it back is unpleasant and it is the single fastest fix for filler words and looking at the wrong part of the screen.`,
        repeat: 'once',
      })
      drafts.push({
        title: `Test your camera, microphone and background for ${who}`,
        detail: `Plain wall, light in front of you not behind, phone on silent, and tell the house you are doing it.`,
        dueAt: deadline,
        repeat: 'once',
      })
      drafts.push({
        title: `Prepare two STAR examples for ${who}`,
        detail: `Situation, Task, Action, Result. Two strong ones you can bend to most questions beat six you half remember.`,
        repeat: 'weekly',
      })
      break
    }

    case 'assessment_centre': {
      drafts.push({
        title: `Ask ${who} what their assessment centre involves`,
        detail: `Email whoever invited you. Group exercise, case study, presentation, interview - knowing which is not cheating, and they will tell you.`,
        repeat: 'once',
      })
      drafts.push({
        title: `Match one of your own examples to each of ${who}'s values`,
        detail: `Their values are on their site and the scoring sheet is built from them. One real example each is enough.`,
        repeat: 'once',
      })
      drafts.push({
        title: `Plan your journey and what you are wearing for ${who}`,
        detail: `Check the trains for that day, aim to arrive thirty minutes early, and if it is virtual, do the tech check the night before.`,
        dueAt: deadline,
        repeat: 'once',
      })
      drafts.push({
        title: `Practise one group exercise out loud for ${who}`,
        detail: `Assessors score whether you bring other people in, not whether you talk most. Practise the sentence "what do you think?".`,
        repeat: 'weekly',
      })
      break
    }

    case 'final_interview': {
      drafts.push({
        title: `Re-read the application you sent ${who}`,
        detail: `They will ask about it, and it may have been three months ago.`,
        repeat: 'once',
      })
      drafts.push({
        title: `Write three questions to ask ${who} at the end`,
        detail: `About the training, the team, the first year. Not about pay, and never "I have no questions".`,
        repeat: 'once',
      })
      drafts.push({
        title: `Rehearse your ${who} answers out loud, standing up`,
        detail: `Out loud, not in your head - they are different skills and only one of them is being marked.`,
        dueAt: deadline,
        repeat: 'weekly',
      })
      break
    }

    case 'offer': {
      // Offers expire, and a 17-year-old will not know that a "reply by" date is
      // real. But do not nag for ever: two weeks after the row last changed,
      // assume it is handled.
      if (stageAgeDays <= 14) {
        drafts.push({
          title: `Reply to ${who} to accept or decline`,
          detail: `Offers have reply dates and they are enforced. If you need longer to decide, ask - that is a normal request.`,
          dueAt: deadline,
          repeat: 'once',
        })
        drafts.push({
          title: `Check ${who}'s offer: pay, location, start date and training provider`,
          detail: `Which university or college, how many days a week you study, and where you would actually be based. These are the things people find out too late.`,
          repeat: 'once',
        })
      }
      break
    }
  }

  return drafts
}

// ----------------------------------------------------------- the directory

const stageValidator = v.union(
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
)

// Compile-time guard: if schema.ts adds or renames a stage, this stops
// typechecking rather than silently generating nothing for the new stage.
const _everyStageHandled: Record<ApplicationStage, true> = {
  interested: true,
  applying: true,
  submitted: true,
  online_test: true,
  video_interview: true,
  assessment_centre: true,
  final_interview: true,
  offer: true,
  rejected: true,
  withdrawn: true,
}
void _everyStageHandled

/**
 * Browse the directory.
 *
 * The table is hand-curated and tens of rows, so it is filtered in memory
 * rather than through a search index - one full read of a small table beats
 * maintaining an index we would have to keep in sync. Revisit if it passes a
 * few hundred schemes.
 */
export const listSchemes = query({
  args: {
    search: v.optional(v.string()),
    sector: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { search, sector, limit }) => {
    const all = await ctx.db.query('schemes').collect()
    const needle = search?.trim().toLowerCase()

    let rows = all
    if (sector) rows = rows.filter((s) => s.sector === sector)
    if (needle) {
      rows = rows.filter((s) =>
        `${s.employer} ${s.name} ${s.sector ?? ''}`.toLowerCase().includes(needle),
      )
    }
    rows.sort((a, b) => a.employer.localeCompare(b.employer))

    // Signed-out browsing is allowed - the directory is the top of the funnel.
    // Signed in, mark what is already tracked so the UI can say "tracking".
    const user = await currentUser(ctx)
    const tracked = new Map<string, Id<'applications'>>()
    if (user) {
      const apps = await ctx.db
        .query('applications')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .collect()
      for (const a of apps) if (a.schemeId) tracked.set(a.schemeId, a._id)
    }

    return {
      sectors: [...new Set(all.map((s) => s.sector).filter(Boolean))].sort(),
      total: rows.length,
      schemes: rows.slice(0, limit ?? 100).map((s) => ({
        _id: s._id,
        slug: s.slug,
        employer: s.employer,
        name: s.name,
        level: s.level,
        sector: s.sector,
        url: s.url,
        rolling: s.rolling,
        notes: s.notes,
        // Dates are only ever exposed when a human has checked them. An
        // unverified row is still worth tracking, it just has no countdown.
        opensAt: s.verified ? s.opensAt : undefined,
        closesAt: s.verified ? s.closesAt : undefined,
        verified: s.verified,
        trackedApplicationId: tracked.get(s._id),
      })),
    }
  },
})

/**
 * Load `content/schemes.ts` into the table:  npx convex run timeline:seedSchemes
 *
 * Descriptive fields are overwritten, dates and `verified` are not. Once a
 * human has verified a row, re-running the seed must never quietly throw their
 * checking away.
 */
export const seedSchemes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let created = 0
    let updated = 0
    for (const seed of SCHEME_SEEDS) {
      const existing = await ctx.db
        .query('schemes')
        .withIndex('by_slug', (q) => q.eq('slug', seed.slug))
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, {
          employer: seed.employer,
          name: seed.name,
          level: seed.level,
          sector: seed.sector,
          url: seed.url,
          notes: seed.notes,
          updatedAt: now,
        })
        updated++
      } else {
        await ctx.db.insert('schemes', { ...seed, verified: false, updatedAt: now })
        created++
      }
    }
    return { created, updated, total: SCHEME_SEEDS.length }
  },
})

// -------------------------------------------------------------- tracking

const MAX_LABEL_CHARS = 80
const MAX_TITLE_CHARS = 140
const MAX_DETAIL_CHARS = 500

export const trackScheme = mutation({
  args: {
    schemeId: v.optional(v.id('schemes')),
    // Free-text fallback: most of this market is small employers and council
    // schemes we will never have in the directory, and a timeline that cannot
    // hold the application a user actually cares about is not their timeline.
    customEmployer: v.optional(v.string()),
    customName: v.optional(v.string()),
    stage: v.optional(stageValidator),
    deadlineAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const customEmployer = args.customEmployer?.trim().slice(0, MAX_LABEL_CHARS)
    if (!args.schemeId && !customEmployer) {
      throw new ConvexError('Pick a scheme, or type the employer you are applying to')
    }

    let scheme: Doc<'schemes'> | null = null
    if (args.schemeId) {
      scheme = await ctx.db.get(args.schemeId)
      if (!scheme) throw new ConvexError('That scheme is no longer listed')

      // Tracking is idempotent: tapping "track" twice must not create a second
      // row and double every generated task.
      const already = await ctx.db
        .query('applications')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .collect()
      const dupe = already.find((a) => a.schemeId === args.schemeId)
      if (dupe) return dupe._id
    }

    const now = Date.now()
    const applicationId = await ctx.db.insert('applications', {
      userId: user._id,
      schemeId: args.schemeId,
      customEmployer,
      customName: args.customName?.trim().slice(0, MAX_LABEL_CHARS),
      stage: args.stage ?? 'interested',
      // Copy a verified scheme date onto the application so the user can edit
      // it. An unverified one is deliberately not copied - see effectiveDeadline.
      deadlineAt: args.deadlineAt ?? (scheme?.verified ? scheme.closesAt : undefined),
      notes: args.notes?.trim().slice(0, MAX_DETAIL_CHARS),
      createdAt: now,
      updatedAt: now,
    })

    // Generate straight away rather than waiting for Monday. Someone who has
    // just tracked a scheme is the most engaged they will ever be; an empty
    // list at that moment wastes it.
    const application = (await ctx.db.get(applicationId))!
    await syncTasks(ctx, user._id, application, scheme, now)
    return applicationId
  },
})

export const untrackScheme = mutation({
  args: { applicationId: v.id('applications') },
  handler: async (ctx, { applicationId }) => {
    const user = await requireUser(ctx)
    const application = await ctx.db.get(applicationId)
    if (!application || application.userId !== user._id) {
      throw new ConvexError('Application not found')
    }

    // Generated tasks belong to the application and go with it. Tasks the user
    // wrote themselves are theirs - detach rather than delete, because deleting
    // someone's own note because they stopped tracking a scheme is a betrayal.
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_user_week', (q) => q.eq('userId', user._id))
      .collect()
    for (const task of tasks) {
      if (task.applicationId !== applicationId) continue
      if (task.source === 'generated') await ctx.db.delete(task._id)
      else await ctx.db.patch(task._id, { applicationId: undefined })
    }
    await ctx.db.delete(applicationId)
    return { untracked: applicationId }
  },
})

/**
 * Move an application along. A stage change is exactly the moment the useful
 * work changes, so the tasks are regenerated immediately instead of on the next
 * cron run - being told to practise numerical reasoning three days after the
 * test is how a product loses trust.
 */
export const updateStage = mutation({
  args: { applicationId: v.id('applications'), stage: stageValidator },
  handler: async (ctx, { applicationId, stage }) => {
    const user = await requireUser(ctx)
    const application = await ctx.db.get(applicationId)
    if (!application || application.userId !== user._id) {
      throw new ConvexError('Application not found')
    }
    if (application.stage === stage) return { stage }

    const now = Date.now()
    await ctx.db.patch(applicationId, { stage, updatedAt: now })

    if (isClosed(stage)) {
      // Rejected or withdrawn: clear the outstanding generated work. Nobody
      // needs a reminder to practise for a test they are no longer sitting.
      const week = await ctx.db
        .query('tasks')
        .withIndex('by_user_week', (q) => q.eq('userId', user._id).gte('weekOf', weekOf(now)))
        .collect()
      for (const task of week) {
        if (task.applicationId === applicationId && task.source === 'generated' && !task.doneAt) {
          await ctx.db.delete(task._id)
        }
      }
      return { stage }
    }

    const scheme = application.schemeId ? await ctx.db.get(application.schemeId) : null
    const created = await syncTasks(ctx, user._id, { ...application, stage, updatedAt: now }, scheme, now)
    return { stage, tasksCreated: created }
  },
})

/** Deadline and notes. Separate from the stage so the UI can save either alone. */
export const updateApplication = mutation({
  args: {
    applicationId: v.id('applications'),
    deadlineAt: v.optional(v.number()),
    clearDeadline: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { applicationId, deadlineAt, clearDeadline, notes }) => {
    const user = await requireUser(ctx)
    const application = await ctx.db.get(applicationId)
    if (!application || application.userId !== user._id) {
      throw new ConvexError('Application not found')
    }
    const now = Date.now()
    await ctx.db.patch(applicationId, {
      deadlineAt: clearDeadline ? undefined : (deadlineAt ?? application.deadlineAt),
      notes: notes === undefined ? application.notes : notes.trim().slice(0, MAX_DETAIL_CHARS),
      updatedAt: now,
    })
    // A new deadline changes what is urgent, so re-run the rules now.
    const updated = (await ctx.db.get(applicationId))!
    const scheme = updated.schemeId ? await ctx.db.get(updated.schemeId) : null
    await syncTasks(ctx, user._id, updated, scheme, now)
    return { deadlineAt: updated.deadlineAt }
  },
})

export const myApplications = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    const apps = await ctx.db
      .query('applications')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const week = await ctx.db
      .query('tasks')
      .withIndex('by_user_week', (q) => q.eq('userId', user._id).eq('weekOf', weekOf(now)))
      .collect()

    const rows = []
    for (const application of apps) {
      const scheme = application.schemeId ? await ctx.db.get(application.schemeId) : null
      const deadline = effectiveDeadline(application, scheme)
      const open = week.filter((t) => t.applicationId === application._id && !t.doneAt).length
      rows.push({
        _id: application._id,
        stage: application.stage,
        notes: application.notes,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        employer: employerLabel(application, scheme),
        name: scheme?.name ?? application.customName ?? 'Apprenticeship',
        url: scheme?.url,
        schemeId: application.schemeId,
        deadlineAt: deadline,
        daysUntilDeadline: deadline === undefined ? undefined : daysUntil(deadline, now),
        deadlineIsVerified: application.deadlineAt !== undefined ? true : Boolean(scheme?.verified),
        openTasksThisWeek: open,
      })
    }

    // Live applications first, then soonest deadline, then most recently touched.
    // A closed application is history, not a to-do.
    rows.sort((a, b) => {
      const closed = Number(isClosed(a.stage)) - Number(isClosed(b.stage))
      if (closed) return closed
      const ad = a.deadlineAt ?? Number.MAX_SAFE_INTEGER
      const bd = b.deadlineAt ?? Number.MAX_SAFE_INTEGER
      if (ad !== bd) return ad - bd
      return b.updatedAt - a.updatedAt
    })
    return rows
  },
})

// ----------------------------------------------------------------- the week

/**
 * This week's list, split the way a person actually reads it.
 *
 * `overdue` includes last week's unfinished tasks as well as this week's past
 * their due date. Anything else quietly loses the work someone did not get to,
 * which is exactly the work that matters most.
 */
export const myWeek = query({
  args: { weekOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    const thisWeek = args.weekOf ?? weekOf(now)
    const lastWeek = weekOffset(Date.parse(`${thisWeek}T00:00:00.000Z`), -1)

    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_user_week', (q) => q.eq('userId', user._id).gte('weekOf', lastWeek))
      .collect()

    const apps = await ctx.db
      .query('applications')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    const labels = new Map<string, string>()
    for (const application of apps) {
      const scheme = application.schemeId ? await ctx.db.get(application.schemeId) : null
      labels.set(application._id, employerLabel(application, scheme))
    }

    const shape = (t: Doc<'tasks'>) => ({
      _id: t._id,
      title: t.title,
      detail: t.detail,
      dueAt: t.dueAt,
      weekOf: t.weekOf,
      source: t.source,
      doneAt: t.doneAt,
      applicationId: t.applicationId,
      employer: t.applicationId ? labels.get(t.applicationId) : undefined,
    })

    const overdue: ReturnType<typeof shape>[] = []
    const dueThisWeek: ReturnType<typeof shape>[] = []
    const done: ReturnType<typeof shape>[] = []

    for (const task of rows) {
      if (task.doneAt) {
        if (task.weekOf === thisWeek) done.push(shape(task))
        continue
      }
      const carriedOver = task.weekOf < thisWeek
      if (carriedOver || (task.dueAt !== undefined && task.dueAt < now)) overdue.push(shape(task))
      else if (task.weekOf === thisWeek) dueThisWeek.push(shape(task))
    }

    // Dated work first and soonest first; undated work keeps its insertion
    // order, which is the priority order tasksFor returned it in.
    const byDue = (a: { dueAt?: number }, b: { dueAt?: number }) =>
      (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER)
    overdue.sort(byDue)
    dueThisWeek.sort(byDue)

    return {
      weekOf: thisWeek,
      overdue,
      dueThisWeek,
      done,
      // The number a 17-year-old actually reads: how much is left.
      remaining: overdue.length + dueThisWeek.length,
    }
  },
})

export const addTask = mutation({
  args: {
    title: v.string(),
    detail: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    applicationId: v.optional(v.id('applications')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const title = args.title.trim().slice(0, MAX_TITLE_CHARS)
    if (!title) throw new ConvexError('Give the task a name')
    if (args.applicationId) {
      const application = await ctx.db.get(args.applicationId)
      if (!application || application.userId !== user._id) {
        throw new ConvexError('Application not found')
      }
    }
    const now = Date.now()
    // A task lands in the week it is due, not the week it was typed, so
    // planning ahead does not clutter today.
    return ctx.db.insert('tasks', {
      userId: user._id,
      applicationId: args.applicationId,
      title,
      detail: args.detail?.trim().slice(0, MAX_DETAIL_CHARS),
      dueAt: args.dueAt,
      weekOf: weekOf(args.dueAt ?? now),
      source: 'user',
      createdAt: now,
    })
  },
})

export const completeTask = mutation({
  args: { taskId: v.id('tasks'), done: v.optional(v.boolean()) },
  handler: async (ctx, { taskId, done }) => {
    const user = await requireUser(ctx)
    const task = await ctx.db.get(taskId)
    if (!task || task.userId !== user._id) throw new ConvexError('Task not found')
    // Un-ticking has to work: people tick the wrong row, and a list you cannot
    // correct is a list you stop trusting.
    const doneAt = (done ?? true) ? Date.now() : undefined
    await ctx.db.patch(taskId, { doneAt })
    return { doneAt }
  },
})

export const deleteTask = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx)
    const task = await ctx.db.get(taskId)
    if (!task || task.userId !== user._id) throw new ConvexError('Task not found')
    await ctx.db.delete(taskId)
    return { deleted: taskId }
  },
})

// ------------------------------------------------------ weekly generation

/** Per application, so ten tracked schemes cannot produce fifty tasks. */
const MAX_TASKS_PER_APPLICATION = 3
/** Per user per week. Above this a list stops being a plan and becomes a wall. */
const MAX_GENERATED_PER_WEEK = 12
/**
 * How far back a `once` task is remembered. Bounded so the history read stays a
 * short index range; twelve weeks comfortably covers one application cycle.
 */
const HISTORY_WEEKS = 12

/**
 * Write the drafts for one application, skipping anything already there.
 *
 * `history` is the user's recent tasks. `once` drafts are matched across the
 * whole window; `weekly` drafts only within the current week, so they come back
 * next Monday if the rule still applies. Deduplication is by title because the
 * tasks table has no key column - see the note in the module report; a title
 * change in a future deploy will therefore re-issue a `once` task once.
 */
async function writeDrafts(
  ctx: MutationCtx,
  userId: Id<'users'>,
  applicationId: Id<'applications'>,
  drafts: TaskDraft[],
  history: Doc<'tasks'>[],
  now: number,
  budget: number,
): Promise<Doc<'tasks'>[]> {
  const week = weekOf(now)
  const mine = history.filter((t) => t.applicationId === applicationId)
  const everSeen = new Set(mine.map((t) => t.title))
  const seenThisWeek = new Set(mine.filter((t) => t.weekOf === week).map((t) => t.title))

  const written: Doc<'tasks'>[] = []
  for (const draft of drafts) {
    if (written.length >= Math.min(MAX_TASKS_PER_APPLICATION, budget)) break
    const seen = draft.repeat === 'once' ? everSeen : seenThisWeek
    if (seen.has(draft.title)) continue
    const id = await ctx.db.insert('tasks', {
      userId,
      applicationId,
      title: draft.title.slice(0, MAX_TITLE_CHARS),
      detail: draft.detail?.slice(0, MAX_DETAIL_CHARS),
      dueAt: draft.dueAt,
      weekOf: week,
      source: 'generated',
      createdAt: now,
    })
    written.push((await ctx.db.get(id))!)
    seen.add(draft.title)
  }
  return written
}

/** Recent tasks for a user, used for deduplication. One bounded index range. */
async function recentTasks(ctx: MutationCtx, userId: Id<'users'>, now: number) {
  return ctx.db
    .query('tasks')
    .withIndex('by_user_week', (q) =>
      q.eq('userId', userId).gte('weekOf', weekOffset(now, -HISTORY_WEEKS)),
    )
    .collect()
}

/** Regenerate one application's tasks now (used on track, stage change, deadline change). */
async function syncTasks(
  ctx: MutationCtx,
  userId: Id<'users'>,
  application: Doc<'applications'>,
  scheme: Doc<'schemes'> | null,
  now: number,
): Promise<number> {
  const applicationId = application._id
  const history = await recentTasks(ctx, userId, now)
  const usedThisWeek = history.filter(
    (t) => t.weekOf === weekOf(now) && t.source === 'generated',
  ).length
  const budget = MAX_GENERATED_PER_WEEK - usedThisWeek
  if (budget <= 0) return 0
  const drafts = tasksFor(application, scheme, now)
  const written = await writeDrafts(ctx, userId, applicationId, drafts, history, now, budget)
  return written.length
}

/**
 * The Monday job: every user with live applications gets a week's worth of work.
 *
 * Register it in convex/crons.ts (owned elsewhere - this file must not edit it):
 *
 *   crons.weekly(
 *     'generate weekly tasks',
 *     { dayOfWeek: 'monday', hourUTC: 6, minuteUTC: 0 },
 *     internal.timeline.generateWeeklyTasks,
 *   )
 *
 * Monday 06:00 UTC so the list is waiting before school. It is safe to run more
 * than once - every write is deduplicated against the week's existing tasks -
 * which matters because a cron that cannot be retried is a cron that silently
 * skips a week.
 *
 * Scale note: this reads the whole applications table. That is right while the
 * table is small and one transaction is the simplest correct thing. When it
 * stops being small, page over users and schedule a mutation per user instead.
 */
export const generateWeeklyTasks = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const applications = await ctx.db.query('applications').collect()

    const byUser = new Map<Id<'users'>, Doc<'applications'>[]>()
    for (const application of applications) {
      if (isClosed(application.stage)) continue
      const list = byUser.get(application.userId) ?? []
      list.push(application)
      byUser.set(application.userId, list)
    }

    let created = 0
    for (const [userId, apps] of byUser) {
      const history = await recentTasks(ctx, userId, now)
      let budget =
        MAX_GENERATED_PER_WEEK -
        history.filter((t) => t.weekOf === weekOf(now) && t.source === 'generated').length
      if (budget <= 0) continue

      // Soonest deadline first, so if the weekly budget runs out it runs out on
      // the applications that could still wait.
      const ordered = [...apps].sort((a, b) => {
        const ad = a.deadlineAt ?? Number.MAX_SAFE_INTEGER
        const bd = b.deadlineAt ?? Number.MAX_SAFE_INTEGER
        return ad - bd
      })

      for (const application of ordered) {
        if (budget <= 0) break
        const scheme = application.schemeId ? await ctx.db.get(application.schemeId) : null
        const drafts = tasksFor(application, scheme, now)
        if (!drafts.length) continue
        const written = await writeDrafts(
          ctx,
          userId,
          application._id,
          drafts,
          history,
          now,
          budget,
        )
        history.push(...written)
        budget -= written.length
        created += written.length
      }
    }

    return { weekOf: weekOf(now), users: byUser.size, applications: applications.length, created }
  },
})
