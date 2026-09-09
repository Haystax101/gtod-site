# Getting Charge in front of real applicants

Written 9 September 2026. What stands between the current build and a student
using this for a real application, in the order it needs doing.

This is deliberately blunt about what is unfinished. Several things work on a
laptop with a developer watching and would not survive a nervous seventeen year
old on a phone the night before a deadline.

---

## 1. Where things actually stand

**Nothing is live.** The domain still serves the old static landing page.

| | State |
| --- | --- |
| `main` | The original static site. 64 commits behind `integration`. |
| `integration` | Everything: Charge, playbook, timeline, answers, voice, community, CV builder. |
| Preview | https://haystax101.github.io/gtod-site/ builds from `integration` |
| Production Convex | Deployment exists, **zero environment variables set** |
| Clerk | Development keys only |

Two pull requests are open. #1 is fully superseded by #2 and should be closed.

There is also a fourth branch, `claude/voice-chat-mobile-drawer`, holding voice
work from another agent that is **not** in `integration`. Someone needs to
decide whether it lands or is abandoned before more voice work happens, or the
same bugs get fixed twice in two places.

---

## 2. Blockers, in order

Nothing below is optional. In sequence, because each depends on the last.

### 2.1 Merge the branches and pick one line of work

Four branches, two of them touching voice. Land `integration`, rebase or drop
the others, close PR #1.

### 2.2 Configure the production backend

The production Convex deployment is empty. Every variable currently on dev
needs setting there with `--prod`:

```
CLERK_JWT_ISSUER_DOMAIN   OPENROUTER_API_KEY        OPENROUTER_MODEL_FLASH
OPENROUTER_MODEL_PRO      GEMINI_API_KEY            EMBEDDINGS_API_KEY
EMBEDDINGS_URL            EMBEDDINGS_MODEL          EMBEDDINGS_DIMENSIONS
STRIPE_SECRET_KEY         STRIPE_PRICE_ID           STRIPE_WEBHOOK_SECRET
SITE_URL                  FAA_API_KEY
```

Then seed it, because a fresh deployment has an empty database:

```
npx convex run knowledge:seed --prod
npx convex run timeline:seedSchemes --prod
npx convex run vacancies:refresh --prod
npx convex run knowledge:reindex --prod
```

The 876 TikTok notes also need re-ingesting against production, or exporting
from dev and importing. Currently they exist only on the dev deployment.

### 2.3 Move Clerk to production keys

The console currently warns that Clerk is running on development keys, which
carry strict usage limits and are not for deployed applications. This needs a
production instance, the domain verified, and the publishable key updated in
both the GitHub secret and the Convex issuer variable.

**This alone will break sign-in for real users if skipped.**

### 2.4 Add the missing deploy secret

GitHub currently holds `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_CONVEX_URL`.
`CONVEX_DEPLOY_KEY` is missing, so the workflow cannot deploy the backend. Add
it from the production deployment's settings.

### 2.5 Point Hostinger at the built output

Hostinger tracks `main` and serves it as static files. The app needs a build
step, so it must track the `deploy` branch that the workflow publishes. Doing
this before 2.2 and 2.3 means shipping a broken app to the live domain.

### 2.6 Take a real payment end to end

Stripe has never been exercised beyond configuration. Before charging anyone:
subscribe with a test card, confirm the webhook flips the plan to Pro, cancel
through the portal, and confirm it flips back. The webhook needs a second
endpoint registered against the production deployment URL.

---

## 3. Voice chat, which is not finished

Voice has been the most troublesome feature and is the least ready. Several
fixes went in without ever being confirmed working.

### 3.1 Unverified: the barge-in rework

The last significant change replaced a microphone gate with the pattern the
Live API actually intends: continuous streaming, server-side voice activity
detection, and stopping queued speech when the server reports an interruption.
Echo is handled by publishing playback as a media stream so the browser's echo
canceller can see it.

**None of this has been tested.** It is a substantial rewrite of the audio path
based on documentation rather than observation. It may work perfectly or it may
have reintroduced the echo loop. Test on speakers, deliberately, and try
talking over Charge mid-sentence.

### 3.2 Unexplained: the call that cut off

A call ended unexpectedly and the cause was never established. Ruled out: the
monthly allowance (8.2 of 60 minutes used), the per-session cap, and server-side
session errors (all 16 sessions recorded a clean end). The prime suspect was the
microphone gate holding the input shut for many seconds after a long answer,
which the rework removes. If it recurs, the diagnostic lines are:

```
[voice] mic gated, Charge still has audio queued {secondsQueued}
[voice] socket closed {code, reason, reachedLive}
```

### 3.3 Known limitation: backgrounding kills a call

Audio capture uses `ScriptProcessorNode`, which is deprecated and which iOS
suspends when the screen locks or the user switches apps. A student checking a
message mid-call will lose it. Fixing this properly means migrating to an
`AudioWorklet`, which is real work rather than a tweak, and is the single
biggest technical debt in the feature.

### 3.4 Untested: iPhone entirely

Voice has never run on a phone. Three specific risks:

- **The ringer switch.** iOS can silence Web Audio depending on the audio
  session, so a muted phone may produce a call with no sound and no error.
- **Earpiece routing.** With a microphone active, iOS may route output to the
  earpiece rather than the speaker, which sounds like silence unless held to
  the ear.
- **Safari strictness.** Safari has already produced two bugs here that Chrome
  did not.

Test with Safari's remote inspector attached, filtering the console for
`[voice]`.

### 3.5 Weak: what Charge knows during a call

A call retrieves from the knowledge base exactly once, before anyone has
spoken, against a seed built from the user's applications. Ask a question
mid-call about something else and the loaded context is irrelevant, which is
why answers can feel vague and non-committal.

The proper fix is retrieval per question, which needs tool calling on the Live
session so Charge can look things up while talking. Until then the mitigation
is what is already there: tracked schemes and the user's own applications
passed in up front.

### 3.6 Cosmetic: the voice cannot be British by request

The Live API rejects `en-GB`, so an accent cannot be asked for. The current
setup sends no voice name, which returns the provider default that happens to
sound British. Naming any specific voice made it American. This is fine as it
stands but is at the mercy of Google changing their default.

---

## 4. Feature gaps that will be noticed immediately

### 4.1 The CV builder cannot export

A student can build a CV and then has no way to submit it. Copying out of the
preview is not a real answer. This needs a Word or PDF download, and it is the
difference between a demo and a tool. **Highest-value single addition on this
list.**

### 4.2 The scheme directory has almost no dates

65 schemes: 40 hand-written employers with no dates, and 25 live vacancies from
the government feed. The feed turned out to be overwhelmingly level 2 and 3
apprenticeships, so it yields very few degree roles.

Deadlines are the reason a student would open a timeline at all. The realistic
fix is a human verifying closing dates for the ten or fifteen employers this
audience actually applies to, which is an afternoon's work and worth more than
any code here.

### 4.3 Landing page placeholders

`src/pages/Home.jsx` still carries `TODO` markers for the Spotify show URL, the
YouTube channel and the Instagram handle. All three are linked from the footer
and the follow section.

### 4.4 The knowledge base is broader than the product

876 notes ingested from TikTok, and the filter kept a lot of general university
life content alongside the careers material. Not wrong, but it means Charge
will answer questions about student discounts and football teams as readily as
about cover letters. Worth a pass to decide whether that is the product.

---

## 5. Legal and safety, before real teenagers use it

- **Age.** The terms assume 18+. The actual audience is 16 to 18. Either the
  wording changes to reflect parental consent, or the product genuinely gates
  on age. This is currently an assumption written into a document rather than
  anything enforced.
- **Uploaded documents.** CVs contain names, addresses, schools and phone
  numbers. Retention is 30 days and there is a cron enforcing it, which is
  good. What does not exist is a way for a user to delete their account and
  everything in it on request, which UK GDPR requires.
- **Community moderation.** A cohort feature where teenagers post to each other
  needs someone accountable for what appears. There is a moderation module and
  a `COMMUNITY_MODERATORS` variable, neither configured.
- **Voice recordings.** Confirm with Google what is retained from Live sessions
  and reflect it in the privacy policy, which currently does not mention voice
  at all.

---

## 6. Testing and quality gaps

- **Two suites cannot run.** `community/moderation` and `timeline/rules` need
  Node 22 for `registerHooks`; the machine runs Node 20. Four of six suites
  pass, 150 assertions.
- **No CI.** Nothing runs tests or the typecheck on push. Given a missing
  variable reached production once already, `npm run typecheck` and
  `tools/test.sh` belong in the deploy workflow as a gate.
- **No error reporting.** When something breaks for a student, nobody finds
  out. PostHog is wired but unconfigured; even just switching it on would
  surface the first crash.
- **Nothing tested on a phone except the landing page.** The chat, timeline,
  answer bank, CV builder and community pages have only ever been seen on a
  laptop.

---

## 7. A sensible order

**Before anyone outside the team touches it**

1. Merge the branches, close PR #1, decide on the stray voice branch
2. Production Convex variables, seeds and reindex
3. Clerk production instance
4. `CONVEX_DEPLOY_KEY` secret, then repoint Hostinger
5. Fill in the three landing page links
6. Verify Stripe end to end on a test card

**Before students rely on it**

7. CV export to Word or PDF
8. Voice tested properly: speakers, interruption, iPhone, Safari inspector
9. Verify closing dates for the fifteen employers that matter
10. Account deletion, age wording, privacy policy covering voice
11. Typecheck and tests in CI, analytics switched on

**Worth doing once it is real**

12. `AudioWorklet` migration so calls survive a locked screen
13. Mid-call retrieval via tool calling
14. Decide whether the general university content belongs in the knowledge base

---

## 8. Honest summary

The build is further along than it looks: the hard parts, retrieval with
citations, metered billing, a knowledge base grounded in GTOD's own material,
all work. What is missing is mostly the unglamorous last mile, configuration,
verification and the parts that only matter when a real person is on the other
end.

Two things would embarrass us fastest in front of a student. A CV they can
build and cannot download. And a voice call that dies when they glance at a
notification. Both are known, both are fixable, and neither is fixed.
