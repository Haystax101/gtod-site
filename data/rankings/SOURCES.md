# Rankings source data

Raw data behind `public/rankings/`. Kept so a ranking can be rebuilt or
refreshed without re-doing the research, and so every published number has a
traceable origin.

## Verified and usable

| File | Source | Coverage | Retrieved |
|---|---|---|---|
| `guardian-cs-2026.json` | Guardian University Guide 2026, "Computer science and information systems" (subject id S220) | 110 institutions, all ranked | 2026-09-29 |
| `guardian-law-2026.json` | Guardian University Guide 2026, "Law" (subject id S300) | 110 institutions, all ranked | 2026-09-29 |
| `the-cs-2026-uk.json` | THE World University Rankings 2026, Computer Science subject table, filtered to the UK | 64 UK institutions | 2026-09-29 |

Guardian fields per institution: `rank`, `guardianScore`, `percentSatisfiedWithTeaching`,
`percentSatisfiedWithAssessment`, `careerProspects`, `averageEntryTariff`, `valueAdded`,
`continuation`, `studentStaffRatio`, plus course listings.

THE fields: world rank (`rankLower`/`rankHigher` — equal when not banded), overall score
display, and sub-scores for teaching, researchEnvironment, researchQuality, industry,
internationalOutlook.

Guardian data comes from the interactive's own data files:
`https://interactive.guim.co.uk/atoms/labs/2025/09/university-guide/overview/v/<build>/assets/data/<subjectId>.json`
(subject ids are listed in `overview.json`). THE data comes from
`https://www.timeshighereducation.com/cms-academic/sites/default/files/ranking-dataset/world-university-rankings/2026/subject-ranking/<subject>/ranking-dataset.json`.

## Not obtained — do not invent these

- **QS, both subjects.** topuniversities.com sits behind a Cloudflare bot challenge and
  returns 403 to automated requests. Needs a person with a browser.
- **Complete University Guide, both subjects.** Returns 403 to direct requests. Reading the
  page through a text-extraction model is *not* safe: three separate extractions of the same
  table disagreed on the ranks of Sheffield, Loughborough and York, and silently dropped a row
  so that every metric below it attached to the wrong university. Only the top 10 reproduced
  consistently. Numbers must be copied by hand or taken from a data export.
- **THE Law.** THE's own server returns the *computer science* dataset at the law URL
  (identical md5, and `level1.key` is `computerScience`). Re-check whether this is fixed
  before using it.
