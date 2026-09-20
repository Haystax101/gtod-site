# Get There One Day

getthereoneday.com: the landing page, plus **Field Operations** at `/agents`, the
members' area for followers (missions, ranks, forum, direct line to HQ).

## Layout

- `index.html` - the landing page. Static, styles inlined, unchanged from the original site.
- `agents/index.html` + `src/agents/` - the Field Operations app (React + Vite, React Router under `/agents/*`).
- `convex/` - the backend (Convex): auth, missions, the evidence classifier, forum, direct line, Stripe webhook.
- `public/` - copied verbatim into the build: `assets/` (logo, favicon, hero reel) and `.htaccess` (SPA fallback for `/agents/*`).

## Running locally

```sh
npm install
npx convex dev        # terminal 1: backend, writes .env.local with the dev deployment URL
npm run dev           # terminal 2: http://localhost:5173 (landing) and /agents/
```

The Convex project is `gtod-agents` (team george-hastings). This is separate from the
`gtod-site` Convex project used by the `integration` branch.

## Deploying

Push to `main`. The GitHub Action builds, deploys the Convex backend to production, and
force-pushes the static output to the `deploy` branch. Hostinger must track **`deploy`**:
hPanel → Websites → Manage → Advanced → GIT → branch `deploy`, directory `public_html`.

Repository secret required: `CONVEX_DEPLOY_KEY` (Convex dashboard → gtod-agents → Settings →
Deploy keys → Production).

## Backend environment (Convex dashboard → Settings → Environment variables)

| Variable | Purpose |
|---|---|
| `LEAD_HANDLE` | TikTok handle that becomes Lead Operative on first sign-up (default `george`) |
| `GROQ_API_KEY` | Transcription (whisper-large-v3-turbo). Cheapest option. |
| `GEMINI_API_KEY` | Transcription fallback when there is no Groq key |
| `DEEPSEEK_API_KEY` | The judge. Optional `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL`. |
| `OPENROUTER_API_KEY` | Judge fallback via OpenRouter (`deepseek/deepseek-chat`) when there is no DeepSeek key |
| `STRIPE_PAYMENT_LINK` | The "Fund the operation" link. Absent = no donate button anywhere. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Webhook verification. Endpoint: `https://<deployment>.convex.site/stripe/webhook`, event `checkout.session.completed`. |

The classifier is optional: without keys every submission waits for a human verdict in HQ.

## How evidence is judged

1. Browser records audio (or the agent uploads a voice memo) → uploaded straight to Convex storage.
2. `classify.run` transcribes it, then asks the judge whether the agent said the mission line and
   whether anyone replied, returning `{saidPhrase, gotResponse, encounterCount, confidence}`.
3. Confident yes → approved, points = min(heard, claimed). Confident no → rejected. Anything
   else, or any error → `pending` in HQ. HQ can overturn any verdict; points follow.
4. Recordings are deleted 30 days after review (daily cron).

## Hero phone video

`public/assets/reel.mp4`: a portrait screen recording (iPhone 16 Pro screen, 1206 x 2622;
other portrait sizes are cover-cropped). MP4 (H.264), ideally under ~15 MB. Until the file
exists the phone shows the logo and handle.

## Analytics and the question form

Unchanged from the original landing page: PostHog snippet gated behind a placeholder key in
`index.html`; the ask form posts to FormSubmit and lands in questions@getthereoneday.com.
