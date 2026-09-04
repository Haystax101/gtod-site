/**
 * Live apprenticeship vacancies from the DfE "Find an apprenticeship" service.
 *
 * WHY THIS AND NOT SCRAPING
 *
 * The hand-written directory in content/schemes.ts carries no dates on purpose:
 * inventing a deadline is the one thing that can cost a user a whole year, and
 * scraping employer sites for them carries database-right and terms exposure.
 * This API is the department publishing the same adverts deliberately, under
 * the Open Government Licence, so its dates are authoritative in a way a
 * scraped page never is. Rows from here are therefore allowed to carry dates
 * and drive countdowns.
 *
 * SETUP
 *
 * Register at https://developer.apprenticeships.education.gov.uk, subscribe to
 * the Display Advert API, then:
 *   npx convex env set FAA_API_KEY <your subscription key>
 *
 * Then look at what it actually returns before trusting the mapping:
 *   npx convex run vacancies:probe
 * and refresh with:
 *   npx convex run vacancies:refresh
 *
 * Without a key everything here no-ops, and the hand-written directory is what
 * users see.
 */
import { internalAction, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

const BASE = 'https://api.apprenticeships.education.gov.uk/vacancies'

function apiKey() {
  return process.env.FAA_API_KEY ?? null
}

async function fetchPage(key: string, pageNumber: number, pageSize: number) {
  const url = `${BASE}?pageNumber=${pageNumber}&pageSize=${pageSize}`
  const res = await fetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': key, Accept: 'application/json' },
    redirect: 'manual',
  })
  // The gateway bounces an unrecognised key to the developer portal rather
  // than returning 401, so an HTML body means the key is wrong, not that the
  // service is down. Say so plainly.
  const body = await res.text()
  if (res.status >= 300 && res.status < 400) {
    throw new Error('FAA_API_KEY was rejected by the gateway. Check the subscription key.')
  }
  if (!res.ok) throw new Error(`Find an apprenticeship returned ${res.status}: ${body.slice(0, 200)}`)
  if (body.trimStart().startsWith('<')) {
    throw new Error('Got HTML rather than JSON, which means the key was not accepted.')
  }
  return JSON.parse(body)
}

/**
 * Return one advert exactly as the API gives it.
 *
 * The published documentation does not list the response fields, so rather
 * than guessing silently the mapping below is tolerant and this exists to show
 * the real shape. Run it once after setting the key and correct `mapVacancy`
 * against what comes back.
 */
export const probe = internalAction({
  args: {},
  handler: async (): Promise<unknown> => {
    const key = apiKey()
    if (!key) return 'FAA_API_KEY is not set'
    const page = await fetchPage(key, 1, 1)
    const list = page?.vacancies ?? page?.results ?? page?.items ?? page
    const first = Array.isArray(list) ? list[0] : list
    return { topLevelKeys: Object.keys(page ?? {}), advertKeys: Object.keys(first ?? {}), sample: first }
  },
})

const pick = (row: any, ...names: string[]) => {
  for (const n of names) {
    const val = row?.[n]
    if (val !== undefined && val !== null && val !== '') return val
  }
  return undefined
}

const toTime = (val: unknown) => {
  if (!val) return undefined
  const t = Date.parse(String(val))
  return Number.isNaN(t) ? undefined : t
}

/** Map one advert onto a `schemes` row. Tolerant of field-name variation. */
function mapVacancy(row: any) {
  const externalId = String(
    pick(row, 'vacancyReference', 'vacancyReferenceNumber', 'reference', 'id') ?? '',
  )
  if (!externalId) return null
  const employer = String(pick(row, 'employerName', 'employer', 'companyName') ?? 'Unknown employer')
  const title = String(pick(row, 'title', 'vacancyTitle', 'name') ?? 'Apprenticeship')
  const rawLevel = pick(row, 'level', 'apprenticeshipLevel', 'courseLevel')
  const level = Number.isFinite(Number(rawLevel)) ? Number(rawLevel) : undefined
  const address = pick(row, 'address', 'location') ?? {}
  const locations = [pick(address, 'addressLine3', 'city', 'town'), pick(address, 'postcode')]
    .filter(Boolean)
    .map(String)

  return {
    externalId,
    slug: `faa-${externalId}`,
    employer,
    name: title,
    level,
    sector: pick(row, 'routeName', 'route', 'sector') ? String(pick(row, 'routeName', 'route', 'sector')) : undefined,
    url: String(pick(row, 'vacancyUrl', 'url') ?? `https://www.findapprenticeship.service.gov.uk/apprenticeship/${externalId}`),
    opensAt: toTime(pick(row, 'postedDate', 'startDate', 'liveDate')),
    closesAt: toTime(pick(row, 'closingDate', 'applicationClosingDate')),
    locations: locations.length ? locations : undefined,
    salary: pick(row, 'wage', 'wageText', 'salary')
      ? String(pick(row, 'wageAdditionalInformation', 'wageText', 'wage', 'salary')).slice(0, 200)
      : undefined,
    entryRequirements: pick(row, 'qualifications', 'entryRequirements')
      ? String(pick(row, 'qualifications', 'entryRequirements')).slice(0, 500)
      : undefined,
  }
}

export const upsertVacancies = internalMutation({
  args: {
    rows: v.array(
      v.object({
        externalId: v.string(),
        slug: v.string(),
        employer: v.string(),
        name: v.string(),
        level: v.optional(v.number()),
        sector: v.optional(v.string()),
        url: v.string(),
        opensAt: v.optional(v.number()),
        closesAt: v.optional(v.number()),
        locations: v.optional(v.array(v.string())),
        salary: v.optional(v.string()),
        entryRequirements: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const now = Date.now()
    let created = 0
    let updated = 0
    for (const row of rows) {
      const existing = await ctx.db
        .query('schemes')
        .withIndex('by_externalId', (q) => q.eq('externalId', row.externalId))
        .first()
      // Dates come from the department's own feed, so they are as checked as a
      // date gets. That is what lets these rows drive countdowns.
      const doc = {
        ...row,
        source: 'faa' as const,
        verified: Boolean(row.closesAt),
        verifiedAt: row.closesAt ? now : undefined,
        updatedAt: now,
      }
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        updated++
      } else {
        await ctx.db.insert('schemes', doc)
        created++
      }
    }
    return { created, updated }
  },
})

/** Drop API rows whose closing date has passed, so the list stays honest. */
export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const all = await ctx.db.query('schemes').collect()
    const stale = all.filter((s) => s.source === 'faa' && s.closesAt && s.closesAt < now)
    for (const s of stale) await ctx.db.delete(s._id)
    return { removed: stale.length }
  },
})

export const refresh = internalAction({
  args: { pages: v.optional(v.number()), pageSize: v.optional(v.number()) },
  handler: async (ctx, { pages = 5, pageSize = 100 }): Promise<unknown> => {
    const key = apiKey()
    if (!key) return 'FAA_API_KEY is not set, skipping'
    let created = 0
    let updated = 0
    let seen = 0
    for (let page = 1; page <= pages; page++) {
      const body = await fetchPage(key, page, pageSize)
      const list = body?.vacancies ?? body?.results ?? body?.items ?? []
      if (!Array.isArray(list) || list.length === 0) break
      seen += list.length
      const rows = list.map(mapVacancy).filter(Boolean) as any[]
      if (rows.length) {
        const result = await ctx.runMutation(internal.vacancies.upsertVacancies, { rows })
        created += result.created
        updated += result.updated
      }
      if (list.length < pageSize) break
    }
    const pruned = await ctx.runMutation(internal.vacancies.pruneExpired, {})
    return { seen, created, updated, ...pruned }
  },
})
