# Get There One Day

getthereoneday.com: the landing page, plus **Field Operations** at `/agents`, the
members' area for followers (missions, ranks, forum, direct line to HQ).

## Layout

- `index.html` - the landing page. Static, styles inlined, unchanged from the original site.
- `agents/index.html` + `src/agents/` - the Field Operations app (React + Vite, React Router under `/agents/*`).
- `convex/` - the backend (Convex): auth, missions and field reports, forum, direct line, Stripe webhook.
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
| `STRIPE_PAYMENT_LINK` | The "Fund the operation" link. Absent = no donate button anywhere. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Webhook verification. Endpoint: `https://<deployment>.convex.site/stripe/webhook`, event `checkout.session.completed`. |

## How a mission is scored

1. The agent picks a mission and writes up what happened, in their own words (80 - 4000 characters).
   Nothing is recorded or uploaded: the story is the whole submission.
2. The row lands as `pending` and sits in HQ's queue. There is no automatic scoring.
3. George reads it and either approves it - awarding points, one by default - or rejects it, with an
   optional note back to the agent. Points land on the agent and the board immediately, and a
   re-score moves them the other way just as cleanly.
4. Approved stories are published inside the app: the brief's field-report feed and the agent's
   profile. Rejected and pending ones stay private to the agent and HQ.

Voice evidence was retired in favour of this. The audio-era columns are still on the `submissions`
table so old rows validate and so HQ can finish reviewing anything left in the queue; recordings
are deleted 30 days after review (daily cron) and nothing writes them any more.

## Hero phone video

`public/assets/reel.mp4`: a portrait screen recording (iPhone 16 Pro screen, 1206 x 2622;
other portrait sizes are cover-cropped). MP4 (H.264), ideally under ~15 MB. Until the file
exists the phone shows the logo and handle.

## Analytics and the question form

Unchanged from the original landing page: PostHog snippet gated behind a placeholder key in
`index.html`; the ask form posts to FormSubmit and lands in questions@getthereoneday.com.
