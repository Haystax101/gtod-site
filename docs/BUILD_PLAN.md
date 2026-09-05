# GTOD build plan: the £10 no-brainer

Living document. Written to be picked up cold, by a person or an agent, at any
point. If you are resuming work, read this file first and then
`docs/COST_MODEL.md`.

## The goal

Make Charge Pro (£10/month) obviously worth it, without losing money on any
individual user, and ship inside a one-week window so the September to January
application wave is caught rather than missed.

## What we are building, in dependency order

| # | Feature | Why it wins | Status |
|---|---------|-------------|--------|
| 1 | **Application timeline** | Nobody joins deadlines to the individual. The weekly reason to come back. | in progress |
| 2 | **Answer bank** | Reusable competency answers; compounds switching cost. | in progress |
| 3 | **Charge as coach** | Critique, not ghost-writing. Competitiveness check, rejection debrief. | in progress |
| 4 | **Community cohorts** | The largest gap in the market. Also the largest compliance cost. | in progress |
| 5 | **Voice (Gemini Live)** | Interview prep by phone call, and check-in calls. The headline Pro feature. | in progress |

## Non-negotiable design rules

1. **Never lose money on a user.** Every metered feature is capped server-side
   before the spend happens, not reconciled afterwards. See `COST_MODEL.md`.
2. **Never ship a provider key to the browser.** Voice uses short-lived,
   server-minted session credentials with a hard TTL.
3. **Charge coaches, it does not ghost-write.** This is GTOD's stated position
   and it is also the defensible one: generic AI CV writing is commoditised.
4. **Charge cites, or says it does not know.** Grounded in the verified corpus.
   Never invent a vacancy, deadline, salary or entry requirement.
5. **Under-18s are the core audience, not an edge case.** Every social feature
   is designed on that basis. See the compliance section.

## Architecture

```
convex/
  schema.ts        one owner (do not edit from a feature branch without saying so)
  timeline.ts      schemes, user tracking, weekly task generation
  coach.ts         answer bank, competency critique, competitiveness, rejection debrief
  community.ts     cohorts, posts, moderation queue
  voice.ts         session minting, budget enforcement, spend ledger
  retrieval.ts     chunking + BM25 + fusion (built)
  embeddings.ts    provider-agnostic embeddings (built)
  budget.ts        shared metering used by chat and voice
```

The corpus in `content/apprenticeships/` is the knowledge substrate for all of
it. Timeline scheme dates and coach guidance both read from it.

## Open questions for GTOD

Recorded here so they are not lost. Work continues under the stated assumption
until answered.

1. **Voice minutes per tier.** Assumed: Pro 60 min/month, Flash 5 min lifetime
   trial. Hard-capped either way.
2. **Community and under-18s.** Assumed: cohort posts are moderated
   pre-publication at launch. This is the safest default and the most expensive.
3. **Free vs Pro split.** Assumed: timeline and answer bank free (they drive
   habit), voice and unlimited coaching Pro.
4. **Gemini Live model and rate.** Unverified from this environment; the cost
   model is parameterised so a real rate is a one-line change.

## Decisions taken during the build

Recorded because they came up as genuine forks and someone will otherwise
re-litigate them.

**`timeline.ts` is the sole owner of `applications.stage`.** Logging a rejection
does NOT automatically move the linked application to `rejected`. Stage
transitions generate tasks, and two modules writing the same field is how a
stage ends up flapping between values with tasks regenerating each time. The UI
prompts the user to update the stage instead, which also means the change is
something they chose rather than something that happened to them.

**Every coaching run writes a `coachRuns` row.** Previously only critiques and
rejection debriefs left a trace, so competitiveness checks and interview turns
were invisible to the daily cap - a user could take a second day's allowance by
switching feature. Rows are written at reservation, not on success, so a failed
call is not a free retry.

**`timeline.css` carries the shared app shell** (`.app-page`, `.app-gate`,
skeletons, focus ring) which the other pages import first. One copy rather than
three; the filename undersells what it holds.

**Coaching metering is currently self-contained** rather than using
`convex/budget.ts`, because the two were written concurrently. They enforce the
same caps by the same method. Folding coaching's `beginRun`/`settleRun` into
`budget.ts` is a tidy-up, not a fix, and should happen when someone next touches
either.

## Compliance, which is a real cost not a footnote

The audience is 16-19. That puts community squarely in scope for the UK
Children's code and the Online Safety Act's user-to-user duties. The build
reflects that:

- Posts default to a moderation queue rather than straight to publication.
- Report and block exist from day one, not as a later addition.
- Data minimisation: no DOB stored beyond the age band needed for eligibility.
- A named human must own the moderation queue before community opens publicly.

**Do not launch community to under-18s without taking actual advice.** The code
supports launching it disabled, and that is the default.
