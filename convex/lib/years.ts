// Where someone is in their education. Freshers are the core audience, so
// that is the default for anyone who enrolled before this existed.
export const YEARS = [
  { id: 'fresher', label: 'Fresher (first year)', short: 'Fresher' },
  { id: 'second', label: 'Second year', short: '2nd year' },
  { id: 'third', label: 'Third year', short: '3rd year' },
  { id: 'fourth', label: 'Fourth year or later', short: '4th year+' },
  { id: 'apprentice', label: 'Apprentice', short: 'Apprentice' },
  { id: 'year13', label: 'Year 13', short: 'Year 13' },
  { id: 'year12', label: 'Year 12', short: 'Year 12' },
  { id: 'year11', label: 'Year 11', short: 'Year 11' },
  { id: 'year10', label: 'Year 10', short: 'Year 10' },
] as const

export type YearId = (typeof YEARS)[number]['id']
export const DEFAULT_YEAR: YearId = 'fresher'

export function isYearId(id: unknown): id is YearId {
  return typeof id === 'string' && YEARS.some((y) => y.id === id)
}

export function yearById(id: string | undefined | null) {
  return YEARS.find((y) => y.id === (id ?? DEFAULT_YEAR)) ?? YEARS[0]
}
