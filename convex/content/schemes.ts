/**
 * Seed list for the scheme directory.
 *
 * WHY EVERY ROW IS UNVERIFIED AND UNDATED
 *
 * This file was written without access to any employer's careers page. It
 * therefore records only what is durably true - that this employer runs an
 * early-careers apprenticeship route in the UK - and nothing that changes from
 * year to year. There are deliberately no opening dates, closing dates,
 * salaries or entry requirements anywhere in it.
 *
 * That is not laziness, it is the product position (BUILD_PLAN rule 4: never
 * invent a vacancy, deadline, salary or entry requirement). A row with no date
 * is still useful: a user can track the employer, set their own deadline and
 * get weekly tasks against it. An invented date is worse than nothing - a user
 * who misses a real deadline because we showed them a plausible wrong one has
 * lost a year, and we have lost them.
 *
 * TO PUT DATES IN FRONT OF USERS
 *
 * A human opens the employer's own page, reads the window off it, and sets
 * `opensAt` / `closesAt` / `rolling` together with `verified: true` and
 * `verifiedAt`. Until then `timeline.ts` will not let a scheme date drive a
 * task or a countdown - see `effectiveDeadline()`, which ignores `closesAt` on
 * unverified rows. Only a date the user typed themselves, or a date a human has
 * checked, is allowed to generate work.
 *
 * The URLs below are careers landing pages rather than deep links to a single
 * vacancy, because landing pages rot more slowly. They still need checking on
 * the same pass as the dates.
 *
 * `level` is left undefined almost everywhere on purpose: most of these
 * employers run several apprenticeships at once across levels 3 to 7, so
 * stamping one number on the employer would be a guess. It is set only where
 * the apprenticeship standard itself fixes the level (the solicitor
 * apprenticeship is level 7; the Dyson Institute is a level 6 degree).
 *
 * Load into the database with:  npx convex run timeline:seedSchemes
 */

export interface SchemeSeed {
  /** Stable id used for upsert, so re-seeding edits rows instead of duplicating them. */
  slug: string
  employer: string
  /** A description of the route, not a marketing programme name we cannot check. */
  name: string
  level?: number
  sector?: string
  url: string
  notes?: string
}

export const SCHEME_SEEDS: SchemeSeed[] = [
  // ------------------------------------------------- professional services
  {
    slug: 'deloitte-apprenticeships',
    employer: 'Deloitte',
    name: 'School and college leaver apprenticeships',
    sector: 'Professional services',
    url: 'https://www.deloitte.com/uk/en/careers/students.html',
    notes: 'Big Four. Audit, tax, consulting and technology routes recruit separately - check which one you want before the window opens.',
  },
  {
    slug: 'pwc-apprenticeships',
    employer: 'PwC',
    name: 'School and college leaver programmes',
    sector: 'Professional services',
    url: 'https://www.pwc.co.uk/careers/school-college.html',
    notes: 'Big Four. Applications are usually assessed in the order they arrive, so early matters more than polish at the margin.',
  },
  {
    slug: 'ey-apprenticeships',
    employer: 'EY',
    name: 'School leaver apprenticeships',
    sector: 'Professional services',
    url: 'https://www.ey.com/en_uk/careers/students',
  },
  {
    slug: 'kpmg-apprenticeships',
    employer: 'KPMG',
    name: 'Apprenticeship programmes',
    sector: 'Professional services',
    url: 'https://www.kpmgcareers.co.uk/apprenticeship/',
  },
  {
    slug: 'bdo-apprenticeships',
    employer: 'BDO',
    name: 'School leaver apprenticeships',
    sector: 'Professional services',
    url: 'https://www.bdo.co.uk/en-gb/careers/students',
  },
  {
    slug: 'grant-thornton-apprenticeships',
    employer: 'Grant Thornton UK',
    name: 'Early careers apprenticeships',
    sector: 'Professional services',
    url: 'https://www.grantthornton.co.uk/careers/early-careers/',
  },

  // ------------------------------------------------------ banking and finance
  {
    slug: 'hsbc-apprenticeships',
    employer: 'HSBC UK',
    name: 'Apprenticeship programmes',
    sector: 'Banking and finance',
    url: 'https://www.hsbc.com/careers/students-and-graduates',
  },
  {
    slug: 'barclays-apprenticeships',
    employer: 'Barclays',
    name: 'Apprenticeships',
    sector: 'Banking and finance',
    url: 'https://home.barclays/careers/early-careers/',
  },
  {
    slug: 'lloyds-apprenticeships',
    employer: 'Lloyds Banking Group',
    name: 'Apprenticeships',
    sector: 'Banking and finance',
    url: 'https://www.lloydsbankinggroup.com/careers/early-careers.html',
  },
  {
    slug: 'natwest-apprenticeships',
    employer: 'NatWest Group',
    name: 'Apprenticeships',
    sector: 'Banking and finance',
    url: 'https://jobs.natwestgroup.com/pages/early-careers',
  },
  {
    slug: 'jpmorgan-apprenticeships',
    employer: 'J.P. Morgan',
    name: 'Degree apprenticeships',
    sector: 'Banking and finance',
    url: 'https://careers.jpmorgan.com/uk/en/students',
    notes: 'UK apprenticeships are run out of specific offices rather than nationally - check the location before you apply.',
  },
  {
    slug: 'bank-of-england-apprenticeships',
    employer: 'Bank of England',
    name: 'Apprenticeships',
    sector: 'Banking and finance',
    url: 'https://www.bankofengland.co.uk/careers/early-careers',
  },
  {
    slug: 'aviva-apprenticeships',
    employer: 'Aviva',
    name: 'Early careers apprenticeships',
    sector: 'Insurance',
    url: 'https://www.aviva.co.uk/careers/early-careers/',
  },

  // ----------------------------------------------------------------- technology
  {
    slug: 'ibm-apprenticeships',
    employer: 'IBM UK',
    name: 'Degree and higher apprenticeships',
    sector: 'Technology',
    url: 'https://www.ibm.com/careers/uk-en/early-career/',
    notes: 'One of the longest-running tech apprenticeship schemes in the UK.',
  },
  {
    slug: 'bt-apprenticeships',
    employer: 'BT Group',
    name: 'Apprenticeships',
    sector: 'Technology and telecoms',
    url: 'https://www.bt.com/careers/early-careers/apprentices',
    notes: 'Engineering, software and business routes, spread across a lot of UK sites.',
  },
  {
    slug: 'accenture-apprenticeships',
    employer: 'Accenture UK',
    name: 'Apprenticeships',
    sector: 'Technology and consulting',
    url: 'https://www.accenture.com/gb-en/careers/local/apprenticeships-uk',
  },
  {
    slug: 'capgemini-apprenticeships',
    employer: 'Capgemini UK',
    name: 'Degree apprenticeships',
    sector: 'Technology and consulting',
    url: 'https://www.capgemini.com/gb-en/careers/apprenticeships/',
  },
  {
    slug: 'amazon-apprenticeships',
    employer: 'Amazon UK',
    name: 'Apprenticeships',
    sector: 'Technology and logistics',
    url: 'https://www.amazon.jobs/en-gb/landing_pages/apprenticeships-uk',
    notes: 'Ranges from operations and engineering to software - the routes are very different jobs, read the description properly.',
  },
  {
    slug: 'sky-apprenticeships',
    employer: 'Sky',
    name: 'Early careers apprenticeships',
    sector: 'Media and technology',
    url: 'https://careers.sky.com/earlycareers/',
  },

  // ---------------------------------------------- engineering, defence, aerospace
  {
    slug: 'bae-systems-apprenticeships',
    employer: 'BAE Systems',
    name: 'Apprenticeships',
    sector: 'Defence and engineering',
    url: 'https://www.baesystems.com/en/careers/careers-in-the-uk/apprenticeships',
    notes: 'Security clearance is part of the process, which makes the timeline longer than most. Start early.',
  },
  {
    slug: 'rolls-royce-apprenticeships',
    employer: 'Rolls-Royce',
    name: 'Apprenticeships',
    sector: 'Aerospace and engineering',
    url: 'https://careers.rolls-royce.com/united-kingdom/students-and-graduates',
  },
  {
    slug: 'airbus-apprenticeships',
    employer: 'Airbus UK',
    name: 'Apprenticeships',
    sector: 'Aerospace and engineering',
    url: 'https://www.airbus.com/en/careers/students-and-graduates',
  },
  {
    slug: 'leonardo-apprenticeships',
    employer: 'Leonardo UK',
    name: 'Apprenticeships',
    sector: 'Defence and engineering',
    url: 'https://uk.leonardo.com/en/careers',
  },
  {
    slug: 'jlr-apprenticeships',
    employer: 'JLR',
    name: 'Early careers apprenticeships',
    sector: 'Automotive engineering',
    url: 'https://careers.jlr.com/',
  },
  {
    slug: 'dyson-institute-degree-apprenticeship',
    employer: 'Dyson',
    name: 'Dyson Institute degree apprenticeship',
    // The Dyson Institute exists to run one thing: a level 6 engineering degree
    // apprenticeship. The level is a property of the institution, not a guess.
    level: 6,
    sector: 'Engineering',
    url: 'https://www.dysoninstitute.com/',
    notes: 'Very small intake and its own admissions process rather than a normal careers portal.',
  },

  // ------------------------------------------------- energy and infrastructure
  {
    slug: 'national-grid-apprenticeships',
    employer: 'National Grid',
    name: 'Apprenticeships',
    sector: 'Energy',
    url: 'https://www.nationalgrid.com/careers/early-careers',
  },
  {
    slug: 'network-rail-apprenticeships',
    employer: 'Network Rail',
    name: 'Apprenticeships',
    sector: 'Rail and infrastructure',
    url: 'https://www.networkrail.co.uk/careers/early-careers/apprenticeships/',
  },
  {
    slug: 'tfl-apprenticeships',
    employer: 'Transport for London',
    name: 'Apprenticeships',
    sector: 'Transport and infrastructure',
    url: 'https://tfl.gov.uk/corporate/careers/apprenticeships',
    notes: 'London-based. Engineering, operations and business routes.',
  },
  {
    slug: 'edf-apprenticeships',
    employer: 'EDF UK',
    name: 'Apprenticeships',
    sector: 'Energy',
    url: 'https://www.edfenergy.com/careers/early-careers',
  },
  {
    slug: 'arup-apprenticeships',
    employer: 'Arup',
    name: 'Degree apprenticeships',
    sector: 'Engineering consultancy',
    url: 'https://www.arup.com/careers/students-and-graduates/',
  },
  {
    slug: 'balfour-beatty-apprenticeships',
    employer: 'Balfour Beatty',
    name: 'Apprenticeships',
    sector: 'Construction and infrastructure',
    url: 'https://www.balfourbeatty.com/careers/early-careers/',
  },

  // -------------------------------------------------------------- public sector
  {
    slug: 'civil-service-apprenticeships',
    employer: 'Civil Service',
    name: 'Civil Service apprenticeships',
    sector: 'Government',
    url: 'https://www.civil-service-careers.gov.uk/apprenticeships/',
    notes: 'Dozens of departments recruit separately under one banner, so there is no single deadline - track the department you actually want.',
  },
  {
    slug: 'nhs-apprenticeships',
    employer: 'NHS',
    name: 'NHS apprenticeships',
    sector: 'Healthcare',
    url: 'https://www.healthcareers.nhs.uk/career-planning/study-and-training/apprenticeships',
    notes: 'Individual trusts advertise their own vacancies year round rather than one national scheme.',
  },
  {
    slug: 'gchq-apprenticeships',
    employer: 'GCHQ',
    name: 'Apprenticeships',
    sector: 'Government and security',
    url: 'https://www.gchq-careers.co.uk/early-careers.html',
    notes: 'Nationality and residency rules apply, and vetting takes months. Read the eligibility rules first.',
  },

  // ------------------------------------------------ consumer, science, retail, law
  {
    slug: 'unilever-apprenticeships',
    employer: 'Unilever UK',
    name: 'Degree apprenticeships',
    sector: 'Consumer goods',
    url: 'https://www.unilever.co.uk/careers/students-and-graduates/',
  },
  {
    slug: 'nestle-apprenticeships',
    employer: 'Nestlé UK',
    name: 'Apprenticeships',
    sector: 'Food and consumer goods',
    url: 'https://www.nestle.co.uk/en-gb/jobs/apprenticeships',
  },
  {
    slug: 'gsk-apprenticeships',
    employer: 'GSK',
    name: 'Apprenticeships',
    sector: 'Pharmaceuticals and science',
    url: 'https://www.gsk.com/en-gb/careers/early-talent/',
  },
  {
    slug: 'astrazeneca-apprenticeships',
    employer: 'AstraZeneca',
    name: 'Apprenticeships',
    sector: 'Pharmaceuticals and science',
    url: 'https://careers.astrazeneca.com/early-careers',
  },
  {
    slug: 'tesco-apprenticeships',
    employer: 'Tesco',
    name: 'Apprenticeships',
    sector: 'Retail',
    url: 'https://www.tesco-careers.com/early-careers/',
  },
  {
    slug: 'clifford-chance-solicitor-apprenticeship',
    employer: 'Clifford Chance',
    name: 'Solicitor apprenticeship',
    // The solicitor apprenticeship standard is level 7 by definition, so this
    // one is a fact about the standard rather than a claim about the employer.
    level: 7,
    sector: 'Law',
    url: 'https://www.cliffordchance.com/careers/careers-uk.html',
    notes: 'Six years, ends with qualification as a solicitor. Applications open far earlier in the year than most people expect.',
  },
]
