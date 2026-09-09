---
title: "What GTOD should build"
summary: "Ranked build recommendations for the free apprenticeship section and Charge, scored on value to a 16-19 year old against cost for a tiny team on Convex. Includes legal and practical hazards and an explicit do-not-build list."
last_verified: null            # NEVER VERIFIED - the sources below were not opened
drafted: 2026-09-02
verification: none
status: quarantined            # see ../README.md before repeating any figure here
source_type: websearch-extracts-only
evidence_quality: "Recommendations are GTOD's own strategy. Competitor claims underpinning them inherit the MEDIUM confidence of the other files in this folder."
sources:
  - https://apprentago.co.uk/
  - https://apprentago.co.uk/schools/
  - https://theapprenticecoach.com/
  - https://www.theapprenticeguide.net/
  - https://apprenticecoach.co.uk/products
  - https://www.ratemyapprenticeship.co.uk/
  - https://www.getmyfirstjob.co.uk/about
  - https://www.springpod.com/virtual-work-experience
  - https://www.findapprenticeship.service.gov.uk/
  - https://www.gov.uk/apply-apprenticeship
  - https://www.ucas.com/explore/search/apprenticeships
  - https://www.amazingapprenticeships.com/the-department-for-education/
  - https://notgoingtouni.co.uk/
  - https://successatschool.org/
---

# What GTOD should build

## The strategic conclusion first

The research across `apprentago.md`, `the-apprenticeship-candidate.md`, `landscape-overview.md` and
`feature-matrix.md` points to one conclusion:

> **Do not build a job board. Build the thing that happens around the job board.**

The reasoning is short and it is decisive:

1. **Vacancy data is a commodity.** GOV.UK Find an apprenticeship is the complete, free, statutory
   database. Fourteen competitors re-present a public dataset. Any effort GTOD spends on inventory is
   spent competing with the government on the one axis where the government wins permanently.
2. **The market is saturated at discovery and empty at everything else.** Fourteen organisations help
   you find a vacancy. Three solo operators help you pass an assessment centre. **Zero** offer a peer
   community, rejection support, or an honest read on whether you are competitive.
3. **GTOD's asset is the one thing money cannot buy here.** Apprentago pays creators to rent an
   audience; GTOD *is* the audience. Every competitor's largest cost line is GTOD's existing asset.
4. **The one-visit problem is universal.** Apprentago reports ~450,000 students reached against ~5,000
   daily users. These are deadline tools. GTOD's community and podcast are precisely the retention
   layer nobody else has.

So: **be the place a 16-19 year old belongs during the apprenticeship process, not the place they
search once in March.**

---

## Scoring method

Every candidate is scored on:

- **Value** — how much this genuinely changes an outcome for a 16-19 year old (1-5).
- **Cost** — build and, critically, *run* cost for a tiny team (1-5, where 5 is expensive).
  Run cost includes moderation, content upkeep, support and per-user AI spend.
- **Moat** — how hard it is for Apprentago or The Apprentice Guide to copy within six months.

"Cheap given the stack" means: **Convex** (reactive database with live subscriptions, scheduled
functions and cron, actions for outbound API calls, file storage, and search) plus an **existing AI
chat assistant (Charge)**. Anything expressible as *structured data + a live subscription + a
scheduled job + a well-prompted LLM call* is near-free for GTOD and expensive for a team without
that stack. Anything requiring human hours, video production, or a scraping pipeline is not.

---

## The ranked list

### 1. The Application Timeline — a live, personal "what do I do this week"

**Value 5 · Cost 1 · Moat 3 — build this first.**

The single highest value-to-cost item in the entire analysis. Students do not fail because they
cannot find vacancies; they fail because major schemes open in September and close in November and
nobody told them. The Apprentice Coach's forward calendar of predicted opening dates is the most
useful free artefact found anywhere in this research — and it is a static list. **Nobody joins the
calendar to the individual student.**

Build: a curated table of major schemes with opening and closing dates, students follow the ones
they care about, and a Convex scheduled function fires reminders. Charge answers "what should I be
doing this week?" against the student's own followed schemes.

Why it is cheap: this is a table, a subscription and a cron job — the exact shape Convex is built
for. Reactive queries mean the timeline updates live with no polling.

Why it works: it creates a **legitimate weekly reason to return**, which is the thing every
competitor lacks. It is the retention engine, disguised as a utility.

> Effort is in **curating** the dates, not building. Budget a few hours a month. That curation is
> itself the moat — it is judgement, not data, so it cannot be scraped from you either.

---

### 2. Community — cohort threads for people applying to the same thing

**Value 5 · Cost 3 · Moat 5 — the defensible one.**

**Not one of the fourteen competitors has peer-to-peer community.** This is the largest structural
gap in the market and the one GTOD is uniquely positioned to fill, because it already has a
community and a podcast feeding it.

Build narrow, not broad: threads scoped to a scheme and an intake year ("Deutsche Bank 2027"), not a
general forum. Scoped threads have obvious purpose, stay on topic, and are far easier to moderate.

Why it is cheap to build: Convex live subscriptions make a real-time thread almost trivial.

**Why the cost score is 3, not 1: moderation of under-18s is the real cost, and it is ongoing.**
Budget for it honestly before launching — see the hazards section. Do not launch community until
moderation is resourced.

Why it is the moat: Apprentago can clone a CV builder in a fortnight. It cannot clone a community at
all — communities are earned. This is the only item on this list a competitor genuinely cannot buy.

---

### 3. Charge as an application coach, grounded in real scheme context

**Value 5 · Cost 2 · Moat 3.**

Charge already exists, so the marginal cost is prompt engineering and context, not infrastructure.

The competitive point is precise: **a generic AI CV builder is now worthless** — any student has free
ChatGPT. Apprentago's AI CV is already commoditised. The value is not generation; it is **context**.
Charge should know: which scheme the student is applying to, when it closes, what that employer's
process involves, what this student has already written, and what they were rejected for last time.

Highest-value uses, in order:
1. **Competency answer coaching** — the student writes, Charge critiques against what assessors
   actually look for. Critique is far more useful and far safer than generation.
2. **"Am I competitive for this?"** — an honest read against stated entry requirements. Nobody does
   this. Everybody encourages applying to everything.
3. **Interview question practice** by text, with feedback.
4. **Rejection debrief** — turn a rejection into a specific, named improvement.

Why it is cheap: Convex actions call the model; conversation state is just documents. Cost scales
with usage, so **cap free usage per student per day from day one** — this is the only line item here
with a genuinely variable cost, and it is the one that can surprise you.

> **Position Charge as a coach that pushes back, not a generator that writes for you.** That is
> better for students, cheaper in tokens, defensible against "AI slop" criticism, and — importantly —
> keeps GTOD out of the business of writing applications for people, which employers increasingly
> screen for.

---

### 4. The Answer Bank — reusable competency answers

**Value 4 · Cost 1 · Moat 2.**

Students answer "tell us about a time you showed leadership" thirty times from scratch. Nobody in the
market offers a personal store of their own answers to adapt and reuse.

Build: a simple CRUD store of the student's own answers, tagged by competency, with Charge helping
adapt one to a new question. Trivial on Convex — it is documents and a text field.

Strategically strong because it is **owned data that compounds**. The more a student puts in, the
more expensive leaving becomes. It also makes Charge better, because it is the context Charge needs.

---

### 5. Rejection support — content, community and coaching around the modal outcome

**Value 5 · Cost 2 · Moat 4.**

**The whole market is built around applying, and the most common outcome is rejection.** With 100+
applicants per place, the typical student is rejected repeatedly. There is no content, no product and
no community anywhere in this landscape for that experience.

This is the most on-brand item on the list. It is exactly what a community and a podcast are for, it
costs almost nothing beyond content and a community space that items 2 and 3 already provide, and it
is the emotional core of why someone would stay with GTOD rather than use a tool once.

Combine: podcast episodes with people who were rejected and later succeeded, a community space where
rejection is normal, and Charge's rejection debrief. It converts the market's most painful moment
into GTOD's strongest retention loop.

---

### Also worth doing, in order

**6. Parent layer (Value 4 · Cost 1).** A small set of pages answering what parents actually ask.
Parents are decisive in the university-versus-apprenticeship decision, are often the ones paying, and
**no competitor addresses them at all.** Nearly free — it is content — and excellent SEO.

**7. Honest salary and progression data (Value 4 · Cost 2).** Everyone asserts "£20k+ without debt";
nobody shows earnings five years on versus the graduate route. Use published official sources only,
cite them, and update annually.

**8. Alumni "ask someone who did it" (Value 4 · Cost 3).** GTOD's podcast guests and community are a
ready supply. Structure it as scheduled AMAs, not open 1:1 matching — matching creates a
safeguarding and scheduling burden that a tiny team cannot carry.

**9. Post-offer / first 90 days (Value 3 · Cost 1).** Every competitor stops at the offer. Content
only. Low urgency, but it extends the relationship past the transaction and feeds the podcast.

---

## Legally and practically hard — read before committing

### Scraping vacancy data — do not

The temptation is to scrape GOV.UK Find an apprenticeship, or worse, competitors' boards. Hazards:

- **UK database right** protects a substantial investment in obtaining and presenting a database
  independently of copyright. Systematic extraction from a commercial board is a serious risk.
- **Terms of service.** Every commercial site prohibits automated extraction.
- **Maintenance.** Scrapers break constantly. For a tiny team this is a permanent, unglamorous tax
  that competes directly with the work that actually differentiates GTOD.
- **Stale data is worse than none.** A student who applies to a closed vacancy loses trust permanently.

> [!GAP]
> **DfE does publish apprenticeship vacancy data for reuse, and Crown material is typically Open
> Government Licence.** The exact API, its access requirements and its licence terms **could not be
> verified in this environment** (all outbound requests blocked). **Action: check the official DfE
> vacancy API and its terms before assuming any of this.** If a licensed API exists, ingesting it via
> a Convex scheduled action is legitimate, cheap and robust — and is the *only* route to vacancy data
> that GTOD should consider.

**Recommendation regardless:** even with a licensed feed, **do not compete on inventory** (see item 1
of the strategic conclusion). Link out to GOV.UK. Being the trusted guide that sends you to the
official source is a better position than being the fifteenth incomplete mirror of it.

### Reproducing others' content — do not

- **Do not** copy or aggregate RateMyApprenticeship reviews. Copyright in the reviews plus database
  right in the collection. This is the clearest legal red line in the market.
- **Do not** reproduce Amazing Apprenticeships resources, competitor guides or scheme descriptions.
- **Do** link, cite and attribute. **Do** publish GTOD's own original commentary.
- Facts are not copyright — a scheme's closing date is a fact. **A curated collection of them is a
  database.** Compile GTOD's own from primary sources (the employers' own pages), record where each
  came from, and the position is defensible.

### Under-18 users — the real compliance cost

This is the most commonly underestimated item, and it applies from the first day the community opens.

- The **ICO Children's Code (Age Appropriate Design Code)** applies to services likely to be accessed
  by under-18s. It requires high-privacy defaults, data minimisation, and age-appropriate design.
  A 16-19 audience is squarely in scope.
- **Community means moderation**, and moderation of minors is not optional or occasional. Budget real
  human time. Reporting tools, clear rules, and a named responsible person are the minimum.
- **Online Safety Act** duties are a live consideration for user-to-user services. **Take advice
  before launching community features** — this is the one item on this list where "build it and see"
  is the wrong instinct.
- **Data minimisation is also a cost saving.** Collect the least you can. It reduces both risk and
  Convex storage.

### AI advice to young people

- Charge will be asked about career decisions with real financial consequences. Be explicit that it
  is guidance, not regulated advice, and route safeguarding-adjacent topics (mental health,
  discrimination, employment disputes) to real services rather than answering.
- **Do not let Charge invent vacancies, deadlines or entry requirements.** Ground it in GTOD's own
  curated data and say plainly when it does not know. A hallucinated closing date is a student's
  lost year and a reputational event GTOD cannot afford.
- Cap free usage per student per day. AI is the only variable cost here.

### Practical, not legal

- **Curation is the ongoing job.** Timeline dates and scheme information decay. Budget monthly hours
  permanently, not a one-off build.
- **Seasonality is extreme.** This market peaks September-January. Ship the timeline before the
  autumn scheme-opening window or lose a full year of relevance.
- **A cold community is worse than no community.** Launch it seeded, into a specific cohort, at the
  moment of peak need — not empty and general.

---

## Do not build

| Do not build | Why |
|---|---|
| **A vacancy job board** | GOV.UK is complete, free and statutory. Fourteen competitors already mirror it. Unwinnable and unnecessary. |
| **A vacancy scraper** | Database right, ToS breach, permanent maintenance tax, stale-data trust damage. |
| **A standalone AI CV generator** | Commoditised by free ChatGPT. Apprentago and The Apprentice Guide already have one. Zero differentiation. Coach on CVs instead of generating them. |
| **A reviews site** | RateMyApprenticeship has 16,000+ reviews and a decade of supply relationships. A thin review corpus is worse than none — it misleads students. |
| **Virtual work experience programmes** | Springpod has 700k+ students, employer-built content and a UCAS partnership. Requires employer BD GTOD does not have. Huge content cost. |
| **A school dashboard / Gatsby reporting** | Apprentago sells this at £1,000/yr. It is a different business (enterprise sales, procurement cycles, MIS headaches) and it makes GTOD accountable to teachers rather than students. **It would also destroy GTOD's key differentiator: being unambiguously on the student's side.** |
| **An employer ATS** | Apprentago and GetMyFirstJob are years ahead. Enterprise software, enterprise support burden. |
| **A native mobile app (for now)** | Real cost in build, review cycles and maintenance. A good mobile web experience gets 95% of the value at 10% of the cost. Revisit only when retention is proven. |
| **Human 1:1 coaching as a core product** | Does not scale, caps revenue at team hours, and pits GTOD against a coach with an unfakeable assessor credential. Let Charge do the scalable 80%. |
| **Paid tiers on day one** | The section is free, which is the trust position and the acquisition engine. Nobody in this market publishes prices; being free *and* transparent is a stronger opening move than being cheap. Monetise later, via employers or a premium layer, once retention is proven. |
| **Non-England expansion initially** | Scotland, Wales and NI run different systems. Real research and content cost for a fraction of the audience. Note it, defer it. |

---

## The 90-day shape

1. **Weeks 1-4 — The Application Timeline.** Curated scheme dates, follow, reminders. Ship before the
   autumn window.
2. **Weeks 3-8 — Charge as coach.** Ground it in the timeline data. Lead with answer critique,
   competitiveness checks and rejection debriefs. Cap usage.
3. **Weeks 6-10 — The Answer Bank.** Small, and it makes Charge materially better.
4. **Weeks 8-12 — Community, seeded and scoped.** Only once moderation is genuinely resourced and
   Online Safety Act advice is in hand. Launch into one or two live cohorts, not a general forum.
5. **Continuously — rejection content and the parent layer.** Nearly free, entirely on-brand, strong
   SEO, and directly feeds the podcast.

**The through-line:** every one of these gives a 16-19 year old a reason to come back next week.
That is the thing no competitor in this market has, and it is the thing GTOD is already best at.
