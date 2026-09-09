# Deep research prompt (for a standard Claude chat with web access)

This environment cannot reach research domains (see `RESEARCH_BLOCKED.md`), so
research is done in a normal Claude chat and the output pasted back. The prompt
below is self-contained: the chat cannot read this repo, so every rule it needs
is written into it.

Run **one topic per conversation**. Asking for five documents at once gets
truncated output and thinner sourcing.

---

## The prompt

Copy everything between the lines, replace `{TOPIC}` with one entry from the
queue below, and paste into a new Claude chat with web search or research
enabled.

---8<---

You are researching for Get There One Day (GTOD), a UK community and podcast
for ambitious young people, especially degree apprentices.

I am building a knowledge base that will power a chatbot answering questions
from 16 to 19 year olds in the UK who are applying for apprenticeships. The
chatbot will state whatever you write with complete confidence, to someone
making a decision about their future. A wrong wage rate, deadline or
eligibility rule sends a teenager down the wrong path. Accuracy therefore
matters far more than volume or polish.

Research and write ONE document on: {TOPIC}

## Sourcing rules, in order of importance

1. **Open every source you cite.** Confirm the page actually contains the
   claim. A search result snippet is not a source. If you cannot open a page,
   do not cite it.
2. **Prefer primary sources**, in this order: GOV.UK, legislation.gov.uk,
   Skills England, DfE statistics, ONS, UCAS, then the employer's or
   professional body's own page, then reputable press. Use aggregator sites
   (RateMyApprenticeship, Indeed and similar) only for facts they are
   themselves the source of.
3. **Never invent anything.** No estimated salaries, no guessed deadlines, no
   plausible-sounding entry requirements, no constructed URLs. "Not stated" is
   a good answer.
4. **Date everything volatile.** Wage rates, funding rules, deadlines and
   entry requirements change. Put the "as at" date in the sentence itself, not
   just at the top: "as at September 2026, the rate is X".
5. **Report conflicts, do not resolve them silently.** If two credible sources
   disagree, say so, cite both, and say which you would trust and why. This is
   more useful to me than a confident wrong answer.
6. **Do not copy source wording.** Summarise in your own words. A direct quote
   must be one sentence at most, in quote marks, attributed. Never reproduce a
   source's page copy, its tables, or its distinctive phrasing with words
   swapped.
7. **Separate fact from judgement.** Anything that is your opinion or
   inference rather than a sourced fact must be prefixed `**GTOD take:**`.

## Tone

Write for a 16 year old, not for a careers adviser. Plain English, concrete,
direct. Short paragraphs. No filler, no "in today's competitive landscape", no
motivational padding. Every sentence should carry a fact or a decision.

## Output format

Return the whole document in ONE markdown code block so I can copy it without
formatting loss. Use exactly this structure:

```
---
id: kebab-case-slug
title: A specific, searchable title
summary: >
  One paragraph that stands alone with no context, because it gets embedded
  separately from the body.
region: england | uk | scotland | wales | northern-ireland
audience: [school-leaver, sixth-former, graduate, career-changer, parent]
topics: [three, to, six, tags]
volatility: low | medium | high
last_verified: <today's date, YYYY-MM-DD>
maintainer: gtod
sources:
  - id: s1
    title: Exact page title
    publisher: GOV.UK
    url: https://...
    accessed: <today's date>
    type: primary | secondary | aggregator
---

## In one line

A single sentence that answers the question.

## Key facts

- Each bullet self-contained and independently citable.[^s1]

## <Headings phrased as questions a user would actually ask>

Body text. Each section must make sense on its own, because sections get
retrieved individually. Re-name the subject in each section rather than
writing "it" or "this scheme" across a heading boundary.

> [!GAP]
> Anything you could not verify, and what would settle it.

## Sources

[^s1]: Publisher, "Page title", https://... (accessed YYYY-MM-DD)
```

## Before you finish

State plainly: how many distinct sources you opened, which claims you could
not verify, and anything you found that contradicts itself. If a section of
the topic turned out to be unresearchable, say so rather than padding it.

---8<---

## Topic queue, in priority order

Work down this list. The first two settle contradictions that currently sit
unresolved in the quarantined drafts, so they are worth doing first.

### Tier 1 - settle the contradictions and the highest-stakes facts

1. The current status of the apprenticeship levy in England: whether the
   Growth and Skills Levy has replaced it, is legislated but not in force, or
   was dropped. What employers can spend levy funds on as at September 2026,
   and what Skills England's remit is after it absorbed IfATE.
2. The funding position for Level 7 (master's level) apprenticeships in
   England: what changed, from what date, which age groups remain funded, what
   happens to apprentices already partway through, and whether any exemptions
   apply (the solicitor apprenticeship in particular).
3. Apprentice pay: the apprentice rate of the National Minimum Wage, the date
   it took effect, exactly who it applies to, when an apprentice moves to the
   age-based rate, and what happens in year two.
4. What an apprenticeship legally is in England: employment status, minimum
   duration, the off-the-job training requirement and how it is now measured,
   English and maths requirements, and end-point assessment.
5. Apprenticeship levels 2 to 7: academic equivalence, typical entry
   requirements, the qualification you finish with, and current funding status
   of each.

### Tier 2 - the application process

6. Where UK apprenticeship vacancies are actually advertised, and the real
   weaknesses of each source.
7. The annual application timeline: when big schemes open and close, why
   rolling recruitment rewards applying early, and the year 12 vs year 13
   timing question.
8. Entry requirements and UCAS tariff points: GCSE English and maths rules,
   how tariff points are calculated, BTEC / T Level / Scottish Higher
   equivalence, and what to do if you narrowly miss.
9. Online assessments in UK early careers: the major publishers, what each
   format measures, typical timings, official free practice, and how to
   request reasonable adjustments. Do not reproduce any real test questions.
10. Assessment centres and interviews: what the day contains, what assessors
    score, competency vs strengths interviewing, and published employer or NHS
    frameworks.

### Tier 3 - the employer directory

One document per sector. For these, add this instruction to the prompt:

> For every employer, you must have opened that employer's own early-careers
> page. Never list an employer whose page you could not open. Include a
> summary table with these columns, in this order: Employer, Scheme, Level,
> Locations, Typical entry requirements, Salary (with date), Applications
> open, Source. Write `Not stated` where the employer does not publish
> something. Never infer a salary or a deadline.

11. Accounting and professional services (Big Four plus mid-tier), including
    the professional qualification attached to each scheme.
12. Banking, finance and insurance.
13. Technology and software, including cyber security.
14. Engineering, defence and aerospace.
15. Public sector: Civil Service, NHS, police, and teaching.

### Tier 4 - depth and fairness

16. Apprentice rights: contract, holiday, sick pay, off-the-job entitlement,
    redundancy, reasonable adjustments, and how to complain.
17. Apprenticeship vs university: an evidence-led comparison using DfE
    Longitudinal Education Outcomes, ONS and IFS data. Both sides honestly.
18. Financial support: what apprentices can and cannot get, being precise
    about what they are NOT eligible for.
19. Scotland, Wales and Northern Ireland: how the systems differ and where
    vacancies are listed.
20. Rejection and reapplying: employer reapplication policies, asking for
    feedback, and realistic alternative routes.

### Competitor research

21. **The Apprentice Guide** (`theapprenticeguide.net`) - confirmed by GTOD as
    the competitor to study, and the most product-like brand in the segment.
    What the product actually does, what it costs, what is behind the free
    trial, and how the AI-marked interview practice works. Note: there is no
    UK entity trading as "The Apprenticeship Candidate"; do not search for it.
22. **Apprentago** (`apprentago.co.uk`) - confirm the pricing and feature
    claims in the quarantined profile against their own pages.

## Sending results back

Paste the code block straight into this repo's session. I will run
`tools/corpus/verify.py --net` over it, check the citations resolve, and file
it under `content/apprenticeships/`. If a document comes back with unresolved
conflicts flagged, that is a success, not a failure - it goes in with the
conflict recorded rather than smoothed over.
