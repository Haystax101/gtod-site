# Launch checklist

Everything needed to take this from "code exists" to "running", in order. Each
item says who can do it and what breaks if it is skipped.

## 1. Keys and environment (you)

Set in the **Convex dashboard**, not in a file. Nothing here belongs in git.

| Variable | Needed for | If missing |
|---|---|---|
| `OPENROUTER_API_KEY` | all chat and coaching | Charge returns a clear "not configured yet" message |
| `OPENROUTER_MODEL_FLASH` | free tier model | falls back to a default slug that is **unverified** |
| `OPENROUTER_MODEL_PRO` | Pro tier model | as above |
| `GEMINI_API_KEY` | voice calls | voice returns "not configured yet"; everything else works |
| `VOICE_USD_PER_MINUTE` | cost accounting | defaults to a **placeholder** rate; billing maths will be wrong |
| `VOICE_MINUTES_PRO` / `VOICE_MINUTES_FLASH` | allowances | defaults to 60 / 10 |
| `CLERK_JWT_ISSUER_DOMAIN`, `STRIPE_*` | existing auth and billing | unchanged from before this work |

Front end (`.env.local`, baked in at build time):

| Variable | Needed for |
|---|---|
| `VITE_VOICE_WS_URL` | the voice websocket endpoint |

## 2. Things that must be verified, not assumed (you)

This build environment had **no network access**, so the following could not be
checked against any provider documentation. Each is isolated so that fixing it
is a small, contained edit.

1. **OpenRouter model slugs** in `convex/tiers.ts`. Confirm against OpenRouter's
   model list. They are env-overridable, so this is a dashboard change.
2. **Whether OpenRouter exposes an embeddings endpoint.** If it does not, point
   `EMBEDDINGS_URL` and `EMBEDDINGS_MODEL` at any OpenAI-compatible provider.
   Retrieval works lexically without embeddings, so this is optional.
3. **The voice ephemeral-token request** in `mintEphemeralCredential`
   (`convex/voice.ts`). One fetch. Two rules must survive the edit: the
   credential stays short-lived and single-session, and the raw API key is never
   returned to the browser.
4. **The voice websocket protocol** in `src/lib/voiceClient.js` -
   `encodeFrame`, `decodeFrame` and the `onmessage` branch. Everything else in
   that file (capture, resampling, playback, teardown, timing) is
   provider-independent.
5. **The real per-minute audio rate.** Then run
   `python3 tools/cost/model.py --voice-rate-per-min <rate> --heavy-user` and
   confirm the margin is still positive. If it is not, lower
   `VOICE_MINUTES_PRO` until it is. **Do this before enabling voice.**

## 3. Deploy (you)

```bash
npm install
npx convex dev          # regenerates convex/_generated - REQUIRED
npx convex run knowledge:seed
npx convex run knowledge:reindex
npm run build
```

`npx convex dev` matters more than it looks: `convex/_generated/api.d.ts` is
checked in and does not know about the new modules until codegen runs. Until it
does, typecheck reports "Property 'voice' does not exist" and similar. Those
errors disappear on first codegen and are not real defects.

## 4. Before community opens to anyone (you, and a lawyer)

Community ships **disabled** (`cohorts.enabled`). Before turning it on:

- A **named human** owns the moderation queue with an agreed response time.
  `convex/moderation.ts` is a triage filter that routes to that person; it is
  not a safety system and does not claim to be.
- Take **actual advice** on Online Safety Act duties and the Children's code.
  The audience is 16-19, so this is the core case, not an edge case.
- Decide the auto-approve policy. Default is off: every post is reviewed.

The cost of getting this wrong is not a bug report. Do not shortcut it.

## 5. Verification you can run now

```bash
tools/test.sh                                    # every test
python3 tools/corpus/verify.py                   # corpus integrity
python3 tools/corpus/verify.py --net             # + every cited URL resolves
npx tsc --noEmit -p convex/tsconfig.json         # backend types
npm run build                                    # front end
```

`verify.py --net` has never been run successfully from this environment because
egress is blocked here. **On your machine it will actually work**, and it is the
one check nobody has been able to do: that every URL in the corpus resolves.
Run it first.

## 6. Seeding real content (you)

The corpus is the moat, and it is the part that needs you:

1. Paste research into `content/inbox/`.
2. `python3 tools/corpus/normalise.py content/inbox/*.md`
3. `python3 tools/corpus/verify.py --net`
4. Move passing documents to `content/apprenticeships/<section>/`.
5. `npx convex run knowledge:reindex`

Scheme dates in `convex/content/schemes.ts` ship **unverified with no dates**,
deliberately. A wrong deadline is worse than a missing one: it sends someone to
a closed application and they never trust the product again. Fill them in
against each employer's own page, then set `verified: true`.
