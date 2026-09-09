/**
 * Tests for convex/cvChecks.ts.
 *
 * These rules decide what the builder tells a student their CV is missing, so a
 * wrong rule is worse than no rule: it sends someone to rewrite a section that
 * was already fine, or waves through one that was not.
 */
import { runChecks, estimateWords, type CvLike } from '../../convex/cvChecks'

let failures = 0
const expect = (name: string, cond: boolean) => {
  if (!cond) {
    failures++
    console.log('  x', name)
  } else {
    console.log('  ok', name)
  }
}
const passed = (cv: CvLike, id: string) => runChecks(cv).find((c) => c.id === id)!.passed

const filled: CvLike = {
  fullName: 'George Hastings',
  email: 'george.hastings@example.com',
  phone: '07000 000000',
  personalStatement:
    'I am a detail-oriented student. I have balanced part-time work with A-Levels. I am applying for finance apprenticeships.',
  targetRole: 'Finance Degree Apprenticeship',
  roles: [
    {
      title: 'Sales assistant',
      bullets: ['Managed a till handling 200 transactions a shift', 'Trained 3 new starters'],
    },
  ],
  education: [
    { qualification: 'A-Levels', detail: 'Maths A, Economics A' },
    { qualification: 'GCSEs', detail: 'Maths 8, English 7' },
  ],
  skills: { tools: ['Excel'], industry: ['finance'], soft: ['teamwork'] },
  references: [{ name: 'A Smith' }, { name: 'B Jones' }],
}

console.log('an empty CV')
expect('passes almost nothing', runChecks({}).filter((c) => c.passed).length <= 1)
expect('still reports a length', estimateWords({}) === 0)

console.log('a filled CV')
for (const id of ['contact', 'statement', 'grades', 'experience', 'verbs', 'numbers', 'skills', 'references', 'tailored']) {
  expect(`passes ${id}`, passed(filled, id))
}
expect('counts its words', estimateWords(filled) > 20 && estimateWords(filled) < 400)

console.log('individual rules')
expect(
  'a two sentence statement is too short',
  !passed({ ...filled, personalStatement: 'I am a student. I want a job.' }, 'statement'),
)
expect(
  'six sentences is too long',
  !passed({ ...filled, personalStatement: 'One. Two. Three. Four. Five. Six.' }, 'statement'),
)
expect(
  'GCSEs alone do not satisfy the grades rule',
  !passed({ ...filled, education: [{ qualification: 'GCSEs', detail: 'Maths 8' }] }, 'grades'),
)
expect(
  'bullets that do not open with a verb fail',
  !passed(
    { ...filled, roles: [{ title: 'Sales assistant', bullets: ['Responsible for the till', 'Was on the shop floor'] }] },
    'verbs',
  ),
)
expect(
  'bullets carrying no numbers fail the quantified rule',
  !passed({ ...filled, roles: [{ title: 'Sales assistant', bullets: ['Managed a till', 'Trained new starters'] }] }, 'numbers'),
)
expect('one reference is not enough', !passed({ ...filled, references: [{ name: 'A Smith' }] }, 'references'))
expect('no target role fails tailoring', !passed({ ...filled, targetRole: '' }, 'tailored'))
expect(
  'an unprofessional address is flagged rather than failed',
  Boolean(runChecks({ ...filled, email: 'partygamer420@hotmail.com' }).find((c) => c.id === 'contact')?.detail),
)

console.log(failures ? `\n${failures} failed` : '\nall passed')
if (failures) process.exit(1)
