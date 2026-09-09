# Authoring spec: Get There One Day knowledge corpus

Every document in `content/` is written to be (a) trustworthy enough that a
16-year-old can act on it, and (b) chunkable into a vector store later
(Convex) without losing meaning. Follow this spec exactly.

## Non-negotiables

1. **Every factual claim carries a citation.** Numbers, deadlines, eligibility
   rules, salaries, entry requirements, named schemes. If you cannot cite it,
   do not write it.
2. **You must have actually opened the URL you cite** (WebFetch/WebSearch) in
   the session that wrote the doc, and recorded the date you opened it. Never
   cite a URL you have only inferred, guessed, or remembered.
3. **Primary sources beat secondary.** Preference order:
   1. GOV.UK / legislation.gov.uk / IfATE / Skills England / Ofqual / ONS / UCAS
   2. The employer's own careers or early-careers page
   3. University / training-provider pages
   4. Reputable press (FT, BBC, Times, Guardian, trade press)
   5. Aggregators (RateMyApprenticeship, GetMyFirstJob, Indeed) - use only for
      things aggregators are the actual source of, e.g. their own review scores
3. **Never copy source wording.** Summarise in our own words. Direct quotes
   must be short (a sentence at most), in quote marks, and attributed. Do not
   reproduce long passages, whole tables of someone else's copy, or a source's
   distinctive phrasing with words swapped.
4. **Volatile facts get flagged.** Deadlines, salaries, and scheme details
   change yearly. Anything that expires gets `volatility: high` and an explicit
   "as at" date in the sentence itself, not just in the metadata.
5. **No AI slop.** No filler, no "in today's competitive landscape", no
   invented statistics, no confident claims about what employers "look for"
   unless a source says it. Where something is our own judgement rather than a
   sourced fact, mark it inline as `**GTOD take:**`.
6. **Unknowns are written down, not smoothed over.** Use
   `> [!GAP] <what we could not verify and what would settle it>`.

## File format

Every `.md` file starts with YAML front matter:

```yaml
---
id: uk-apprenticeship-levels            # stable slug, kebab-case, never reused
title: Apprenticeship levels in England explained
summary: >
  One-paragraph plain-English abstract. This is what gets embedded as the
  document-level summary, so it must stand alone with no context.
region: england | uk | scotland | wales | northern-ireland | global
audience: [school-leaver, sixth-former, graduate, career-changer, parent]
topics: [levels, qualifications, entry-requirements]
volatility: low | medium | high
last_verified: 2026-09-02
maintainer: gtod
sources:
  - id: s1
    title: Apprenticeships - GOV.UK
    publisher: GOV.UK
    url: https://www.gov.uk/apprenticeships-guide
    accessed: 2026-09-02
    type: primary
---
```

## Body rules (these exist for RAG)

- Start with an `## In one line` section: a single sentence answer.
- Then `## Key facts` as a short bulleted list, each bullet independently
  citable and self-contained.
- Use `##` / `###` headings that read as questions a user would ask, because
  headings become chunk titles.
- **Each section must make sense in isolation.** Re-name the subject in each
  section instead of writing "it", "this scheme", "they" across a heading
  boundary. A chunk retrieved on its own must not be ambiguous.
- Keep paragraphs under ~80 words. Prefer lists and tables for structured data.
- Citations are footnote style, `[^s1]`, mapping to the `sources` ids, with the
  footnote definitions at the bottom of the file:
  `[^s1]: GOV.UK, "Apprenticeships", https://... (accessed 2026-09-02)`
- End every file with `## Sources` (the footnote block) and, where useful,
  `## Related` linking sibling docs by relative path.

## Tables of employer data

Use this column order so the tables can be parsed into Convex later:

| Employer | Scheme | Level | Locations | Typical entry requirements | Salary (as at date) | Applications open | Source |

Never leave a cell blank - write `Not stated` or `Varies`, and never invent a
salary or a deadline. If the employer does not publish it, say so.
