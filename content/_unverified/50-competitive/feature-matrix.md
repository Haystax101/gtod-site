---
title: "Feature matrix — UK apprenticeship landscape"
summary: "Every distinct feature found anywhere in the market, mapped across 14 competitors, plus the features nobody has built."
last_verified: null            # NEVER VERIFIED - the sources below were not opened
drafted: 2026-09-02
verification: none
status: quarantined            # see ../README.md before repeating any figure here
source_type: websearch-extracts-only
evidence_quality: "MEDIUM — direct page fetches were blocked; cells derive from search-engine extracts. Blank/unknown cells are marked '?' and are genuinely unknown, not 'no'."
sources:
  - https://apprentago.co.uk/
  - https://apprentago.co.uk/platform/
  - https://apprentago.co.uk/schools/
  - https://apprentago.co.uk/employer/
  - https://apprentago.co.uk/cv-builder/
  - https://apprentago.co.uk/early-careers-marketing/
  - https://theapprenticecoach.com/
  - https://apprenticecoach.co.uk/
  - https://apprenticecoach.co.uk/products
  - https://www.theapprenticeguide.net/
  - https://www.ratemyapprenticeship.co.uk/
  - https://higherin.com/company-profile/4043/ratemyapprenticeship
  - https://www.getmyfirstjob.co.uk/
  - https://www.getmyfirstjob.co.uk/about
  - https://apps.apple.com/gb/app/getmyfirstjob/id999795113
  - https://notgoingtouni.co.uk/
  - https://www.springpod.com/virtual-work-experience
  - https://www.partners.springpod.com/product/work-experience-simulations
  - https://successatschool.org/
  - https://www.ucas.com/explore/search/apprenticeships
  - https://www.findapprenticeship.service.gov.uk/
  - https://www.gov.uk/sign-in-apprenticeship-service-account
  - https://www.allaboutschoolleavers.co.uk/
  - https://careermap.co.uk/
  - https://www.amazingapprenticeships.com/
---

# Feature matrix

> [!GAP]
> **Verification limit.** All outbound HTTP was refused by the organisation's egress proxy
> (`403`, every domain). Cells derive from search-engine extracts of the pages in `sources`.
> **`?` means genuinely unverified — treat it as unknown, not as "no".** A confident `N` is used
> only where absence is strongly implied by the product's nature (e.g. GOV.UK does not do community).

**Key:** `Y` = yes, verified · `P` = partial / limited · `N` = no · `?` = unverified

**Columns:** APG = Apprentago · TAC = The Apprentice Coach · AC = Apprentice Coach (.co.uk) ·
TAG = The Apprentice Guide · RMA = RateMyApprenticeship / Higherin · GMFJ = GetMyFirstJob ·
NGTU = Notgoingtouni · SPR = Springpod · SAS = Success at School · UCAS = UCAS ·
GOV = GOV.UK Find an apprenticeship · AASL = AllAboutSchoolLeavers · CM = Careermap ·
AA = Amazing Apprenticeships

## Discovery and inventory

| Feature | APG | TAC | AC | TAG | RMA | GMFJ | NGTU | SPR | SAS | UCAS | GOV | AASL | CM | AA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Searchable live vacancy database | Y | N | N | P | Y | Y | Y | N | Y | Y | Y | Y | Y | N |
| Complete statutory vacancy coverage | N | N | N | N | N | N | N | N | N | N | **Y** | N | N | N |
| Filter by location / proximity | Y | N | N | ? | Y | Y | ? | N | ? | Y | Y | ? | ? | N |
| Filter by industry / role | Y | N | N | ? | Y | Y | ? | Y | Y | Y | Y | ? | ? | N |
| Filter by apprenticeship level | ? | N | N | ? | ? | ? | ? | N | ? | Y | Y | ? | ? | N |
| Filter by salary | N | N | N | N | ? | ? | ? | N | ? | **Y** | ? | ? | ? | N |
| Saved search / vacancy alerts | ? | N | N | ? | ? | ? | ? | ? | ? | ? | **Y** | ? | ? | N |
| Forward calendar of scheme opening dates | N | **Y** | N | P | N | N | N | N | N | N | N | N | N | N |
| Employer profile pages | Y | N | N | P | Y | Y | Y | Y | Y | Y | P | Y | Y | N |
| Employer reviews by real apprentices | N | N | N | N | **Y** | N | N | N | N | N | N | N | N | N |
| Employer ranking / awards | N | N | N | N | **Y** | N | N | N | N | N | N | **Y** | N | N |
| Work experience opportunities listed | Y | N | N | N | Y | Y | ? | Y | Y | Y | N | ? | ? | N |

## Application and selection support

| Feature | APG | TAC | AC | TAG | RMA | GMFJ | NGTU | SPR | SAS | UCAS | GOV | AASL | CM | AA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CV builder | **Y** | N | N | **Y** | N | ? | N | N | N | N | P | N | N | N |
| **AI-generated / ATS-optimised CV** | **Y** | N | N | **Y** | N | N | N | N | N | N | N | N | N | N |
| Per-application CV tailoring | **Y** | N | N | ? | N | N | N | N | N | N | N | N | N | N |
| Cover letter builder | N | N | N | **Y** | N | N | N | N | N | N | N | N | N | N |
| Human CV review | N | **Y** | ? | ? | N | N | N | N | N | N | N | N | N | N |
| Apply directly in-platform | **Y** | N | N | N | P | **Y** | P | N | P | Y | **Y** | P | P | N |
| Application tracker for the student | **Y** | N | N | ? | N | ? | N | N | N | P | P | N | N | N |
| Notes against each application | **Y** | N | N | ? | N | N | N | N | N | N | N | N | N | N |
| Written interview guidance | P | **Y** | **Y** | **Y** | Y | ? | ? | ? | ? | ? | P | **Y** | Y | Y |
| Model interview answers | N | ? | **Y** | **Y** | ? | N | N | N | N | N | N | **Y** | ? | N |
| Live 1:1 human coaching | N | **Y** | **Y** | P | N | N | N | N | N | N | N | N | N | N |
| Automated / AI mock interview | N | N | **Y** | **Y** | N | N | N | N | N | N | N | N | N | N |
| **AI-marked video interview practice** | N | N | N | **Y** | N | N | N | N | N | N | N | N | N | N |
| Psychometric / numerical test practice | N | N | N | **Y** | N | N | N | N | N | N | N | N | N | N |
| Personality test practice | N | N | N | **Y** | N | N | N | N | N | N | N | N | N | N |
| Job simulation exercises | N | N | N | **Y** | N | N | N | **Y** | N | ? | N | N | N | N |
| **Mock assessment centre** | N | **Y** | N | **Y** | N | N | N | N | N | N | N | N | N | N |
| Feedback from a real assessor | N | **Y** | N | N | N | N | N | N | N | N | N | N | N | N |
| Per-employer briefing / fact files | N | ? | N | **Y** | P | N | N | P | N | N | N | ? | N | N |

## Experience, content and inspiration

| Feature | APG | TAC | AC | TAG | RMA | GMFJ | NGTU | SPR | SAS | UCAS | GOV | AASL | CM | AA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Structured video course | N | N | P | **Y** | N | N | N | Y | N | N | N | N | N | N |
| Virtual work experience (8-10 hrs) | N | N | N | N | N | N | N | **Y** | N | **Y** | N | N | N | N |
| Certificate of completion | N | N | N | ? | N | N | N | **Y** | N | ? | N | N | N | N |
| Role / industry explainer content | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | P | Y | Y | **Y** |
| Careers advice articles | P | Y | Y | Y | **Y** | Y | Y | Y | **Y** | Y | P | **Y** | **Y** | Y |
| Apprentice stories / case studies | P | Y | ? | Y | **Y** | Y | Y | Y | Y | Y | N | Y | Y | **Y** |
| Podcast | N | N | N | N | ? | N | N | N | N | N | N | N | ? | N |
| Short-form social video as core channel | **Y** | **Y** | N | **Y** | Y | ? | ? | ? | ? | ? | N | ? | ? | Y |
| Email newsletter | ? | **Y** | **Y** | ? | ? | ? | ? | ? | ? | Y | N | ? | ? | Y |
| Live events / fairs | ? | N | N | N | **Y** | ? | **Y** | ? | ? | Y | N | **Y** | ? | Y |

## Community and identity

| Feature | APG | TAC | AC | TAG | RMA | GMFJ | NGTU | SPR | SAS | UCAS | GOV | AASL | CM | AA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Persistent student account | Y | N | ? | **Y** | Y | **Y** | ? | Y | ? | **Y** | **Y** | ? | ? | N |
| **Peer-to-peer community / forum** | N | N | N | N | N | N | N | N | N | N | N | N | N | N |
| **Ask a current apprentice directly** | N | N | N | N | P | N | N | N | N | N | N | N | N | N |
| **Cohort / accountability groups** | N | N | N | N | N | N | N | N | N | N | N | N | N | N |
| **AI assistant / chat** | P | N | P | **Y** | N | N | N | N | N | N | N | N | N | N |
| Mobile app | N | N | N | N | ? | **Y** | N | ? | N | ? | N | N | N | N |

## Institutional sides

| Feature | APG | TAC | AC | TAG | RMA | GMFJ | NGTU | SPR | SAS | UCAS | GOV | AASL | CM | AA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| School dashboard / oversight | **Y** | N | N | N | ? | ? | N | **Y** | P | Y | N | N | N | P |
| Gatsby / Ofsted reporting | **Y** | N | N | N | N | N | N | ? | N | ? | N | N | N | P |
| Work-experience hour logging | **Y** | N | N | N | N | N | N | **Y** | N | N | N | N | N | N |
| Teacher-ready lesson resources | N | N | N | N | P | N | N | ? | **Y** | ? | N | ? | ? | **Y** |
| Employer applicant tracking (ATS) | **Y** | N | N | N | ? | **Y** | ? | ? | N | N | P | N | N | N |
| Employer diversity analytics | **Y** | N | N | N | ? | ? | N | **Y** | N | ? | N | N | N | N |
| Open API / HR system integration | **Y** | N | N | N | ? | ? | N | ? | N | ? | ? | N | N | N |
| Creator marketing sold to employers | **Y** | N | N | N | ? | N | N | N | N | N | N | N | N | N |

## Commercial

| Feature | APG | TAC | AC | TAG | RMA | GMFJ | NGTU | SPR | SAS | UCAS | GOV | AASL | CM | AA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Free to students | **Y** | P | N | P | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** |
| Student pays for anything | N | **Y** | **Y** | **Y** | N | N | N | N | N | N | N | N | N | N |
| Publicly listed price | P | N | N | N | N | N | N | P | N | N | Y | N | N | Y |
| School subscription | **Y** £1k/yr | N | N | N | ? | ? | N | **Y** | ? | ? | N | N | N | N |
| Employer pays | **Y** | N | N | N | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** | N | **Y** | **Y** | N |
| Public / DfE funding | **Y** | N | N | N | N | P | N | N | N | P | **Y** | N | N | **Y** |
| Published outcome metrics | N | **Y** | N | N | N | P | N | N | N | N | N | N | N | N |

---

## Features nobody in this market has

These are the true whitespace items. Each was checked against all 14 competitors above and found
absent everywhere — this is the list GTOD should be choosing from.

### Tier 1 — high value, structurally unowned

1. **Peer community for applicants.** Not one player has it. Fourteen broadcast channels and three
   coaches, and zero places for a 17-year-old to talk to another 17-year-old going through the same
   thing. This is the largest single gap in the market and the one GTOD is uniquely positioned for.
2. **Rejection support.** The market is built entirely around applying. Nobody addresses what happens
   after the rejection email — and most applicants get many. There is no content, no product and no
   community anywhere for the modal experience of this market.
3. **"Am I actually competitive?" calibration.** Nobody tells a student where they stand before they
   spend six hours on an application. Everyone encourages applying to everything; nobody helps
   prioritise.
4. **Deadline management across multiple applications.** Apprentago tracks applications you have
   made; The Apprentice Coach publishes predicted opening dates. **Nobody joins these up** into a
   personal, forward-looking timeline that tells you what to do this week.
5. **Honest employer information from people who left.** RateMyApprenticeship reviews come from
   current apprentices, structurally selecting for positive experience. Nobody captures the leavers.

### Tier 2 — valuable, moderate effort

6. **Parent-facing layer.** Parents are a decisive influence on the university-versus-apprenticeship
   decision, and often the ones paying for coaching. Not one product addresses them directly.
7. **Salary and progression reality.** Real earnings five years post-apprenticeship versus the
   graduate equivalent. Everyone asserts "£20k+ without debt"; nobody shows the data.
8. **Application component reuse.** Students answer the same competency questions 30 times from
   scratch. Nobody offers a personal answer bank to draw on and adapt.
9. **SME and local apprenticeship visibility.** Advertiser funding means coverage skews to big
   corporates. Most apprenticeships are at small local employers that no commercial site promotes.
10. **Post-offer support.** Every product stops at the offer. Nothing supports the first 90 days,
    when drop-out risk is highest.

### Tier 3 — notable absences

11. **Accessibility / SEND-specific guidance** for apprenticeship applications.
12. **Non-England coverage.** Scotland, Wales and Northern Ireland have different systems; the
    market is overwhelmingly England-first.
13. **Genuine mobile app.** Only GetMyFirstJob verifiably has one, in an audience that is
    mobile-native.
14. **Transparent pricing on paid products.** Not one coach-led brand publishes a price.
15. **Published outcome data.** Only The Apprentice Coach publishes anything ("50+ offers"). The
    entire rest of the market reports reach.
