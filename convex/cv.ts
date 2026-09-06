/**
 * CV builder.
 *
 * The builder stores structure and the applicant's own words, nothing else.
 * There is deliberately no "write my CV" mutation: GTOD's position is that we
 * coach rather than ghost-write, and a CV that a student cannot defend in an
 * interview is worse than a weaker one they wrote themselves. Feedback comes
 * from `runChecks`, which applies the playbook's own rules, and from Charge,
 * which critiques.
 */
import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { requireUser, currentUser } from './users'
import { runChecks, estimateWords } from './cvChecks'

const bulletList = v.array(v.string())

const roleValidator = v.object({
  title: v.string(),
  employer: v.optional(v.string()),
  dates: v.optional(v.string()),
  bullets: bulletList,
})

const internshipValidator = v.object({
  scheme: v.string(),
  employer: v.optional(v.string()),
  dates: v.optional(v.string()),
  bullets: bulletList,
})

const educationValidator = v.object({
  qualification: v.string(),
  detail: v.optional(v.string()),
  school: v.optional(v.string()),
  dates: v.optional(v.string()),
})

const referenceValidator = v.object({
  name: v.string(),
  role: v.optional(v.string()),
  company: v.optional(v.string()),
  email: v.optional(v.string()),
})

const skillsValidator = v.object({
  tools: v.array(v.string()),
  industry: v.array(v.string()),
  soft: v.array(v.string()),
})

/** Everything a caller may change. Ownership and timestamps are ours. */
const editable = {
  title: v.optional(v.string()),
  targetRole: v.optional(v.string()),
  targetEmployer: v.optional(v.string()),
  fullName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  personalStatement: v.optional(v.string()),
  roles: v.optional(v.array(roleValidator)),
  internships: v.optional(v.array(internshipValidator)),
  education: v.optional(v.array(educationValidator)),
  skills: v.optional(skillsValidator),
  references: v.optional(v.array(referenceValidator)),
  achievements: v.optional(v.array(v.string())),
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx)
    if (!user) return []
    const rows = await ctx.db
      .query('cvs')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(50)
    return rows.map((cv) => ({
      _id: cv._id,
      title: cv.title,
      targetRole: cv.targetRole,
      targetEmployer: cv.targetEmployer,
      updatedAt: cv.updatedAt,
      // Enough for a list row to show progress without loading the whole CV.
      complete: runChecks(cv).filter((c) => c.passed).length,
      totalChecks: runChecks(cv).length,
    }))
  },
})

export const get = query({
  args: { id: v.id('cvs') },
  handler: async (ctx, { id }) => {
    const user = await currentUser(ctx)
    if (!user) return null
    const cv = await ctx.db.get(id)
    if (!cv || cv.userId !== user._id) return null
    return { ...cv, checks: runChecks(cv), words: estimateWords(cv) }
  },
})

export const create = mutation({
  args: { title: v.optional(v.string()), targetRole: v.optional(v.string()) },
  handler: async (ctx, { title, targetRole }) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    return ctx.db.insert('cvs', {
      userId: user._id,
      title: title?.trim() || 'Untitled CV',
      targetRole,
      // Seeded from the account so the contact block is not empty on a first
      // open. Every one of these is editable.
      fullName: user.name,
      email: user.email,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: { id: v.id('cvs'), patch: v.object(editable) },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const cv = await ctx.db.get(id)
    if (!cv || cv.userId !== user._id) throw new ConvexError('CV not found')
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() })
  },
})

/**
 * Copy a CV, which is the normal way to start the next application rather than
 * an edge case: the playbook's first rule is to tailor it every time, and
 * tailoring a copy is how you keep the original.
 */
export const duplicate = mutation({
  args: { id: v.id('cvs'), title: v.optional(v.string()) },
  handler: async (ctx, { id, title }) => {
    const user = await requireUser(ctx)
    const cv = await ctx.db.get(id)
    if (!cv || cv.userId !== user._id) throw new ConvexError('CV not found')
    const { _id, _creationTime, ...rest } = cv
    const now = Date.now()
    return ctx.db.insert('cvs', {
      ...rest,
      title: title?.trim() || `${cv.title} (copy)`,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const remove = mutation({
  args: { id: v.id('cvs') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const cv = await ctx.db.get(id)
    if (!cv || cv.userId !== user._id) throw new ConvexError('CV not found')
    await ctx.db.delete(id)
  },
})
