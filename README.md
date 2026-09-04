# Get There One Day site

Website and app for **Get There One Day**, the community for ambitious young people
(degree apprentices especially welcome). 14K+ on TikTok, a 100% Q&A podcast, and now
**Charge**, the GTOD apprenticeship assistant.

React + Vite front end, Convex backend, Clerk auth, Stripe billing.

| Route | What it is |
| --- | --- |
| `/` | Landing page |
| `/apprenticeships` | The Degree Apprenticeship Playbook (free guide, copyable CV and cover letter templates) |
| `/charge` | Charge: chat assistant with document upload, Flash (free) and Pro (£10/mo) tiers |
| `/privacy`, `/terms` | Legal pages |

## Develop

```
npm install
cp .env.example .env.local   # then fill in VITE_CLERK_PUBLISHABLE_KEY
npx convex dev               # pushes convex/ to the dev deployment, writes VITE_CONVEX_URL into .env.local
npm run dev                  # http://localhost:5173
```

Seed the knowledge base once per deployment: `npx convex run knowledge:seed`.

## Structure

- `src/pages/Home.jsx`, `Apprenticeships.jsx` - marketing pages (all copy lives in these files)
- `src/pages/Charge.jsx` - the chat app (sidebar, thread, composer, plans modal)
- `src/pages/Legal.jsx` - privacy policy and terms
- `src/lib/backend.jsx` - Clerk + Convex providers; `extractText.js` - in-browser PDF/DOCX parsing
- `src/styles/` - `global.css` (design tokens, light + dark), `apprenticeships.css`, `charge.css`
- `convex/schema.ts` - users, conversations, messages, attachments, usage, knowledge
- `convex/chat.ts` - send + streaming generation (DeepSeek for Flash, xAI for Pro)
- `convex/tiers.ts` - plan limits, model names and per-token prices, in one place
- `convex/prompt.ts` - Charge's persona and how the knowledge base is injected
- `convex/billing.ts`, `convex/http.ts` - Stripe checkout, portal and webhook
- `convex/content/playbook.ts` - the knowledge base seed (keep in sync with the playbook page)
- `public/assets/` - logo, favicon, hero reel; `public/.htaccess` - SPA rewrite for Hostinger

## How Charge works

1. Sign-in via Clerk; `users.ensure` creates the user row (plan `flash`).
2. `chat.send` checks the daily message cap and monthly cost cap, stores the user message and an
   empty assistant message, and schedules `chat.generate`.
3. `chat.generate` streams from the provider and patches the assistant message every ~250 ms;
   the client subscribes to `messages.list` so the reply appears live. Token usage from the
   provider is recorded into `usage` (micro-dollars, using the prices in `tiers.ts`).
4. Uploads are parsed in the browser; only the text reaches Convex (`attachments`), and a daily
   cron deletes rows older than 30 days.
5. The knowledge base (`knowledge` table) is injected whole into the system prompt. When it
   outgrows that (roughly 30k tokens), populate `knowledgeChunks` with embeddings and switch
   `prompt.ts` to vector search.
6. Stripe Checkout → webhook at `https://<deployment>.convex.site/stripe/webhook` → `users.setSubscription`
   flips the plan to `pro` (and back on cancellation).

## Backend environment variables (Convex dashboard → Settings → Environment variables)

| Variable | Purpose |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Issuer URL from the Clerk JWT template named `convex` |
| `XAI_API_KEY` | Pro tier (Grok 4.5) |
| `DEEPSEEK_API_KEY` | Flash tier (DeepSeek V4 Flash) |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Billing |
| `EMBEDDINGS_API_KEY` | Vector search. Reuse the Gemini key |
| `EMBEDDINGS_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/embeddings` |
| `EMBEDDINGS_MODEL` | `gemini-embedding-001` |
| `EMBEDDINGS_DIMENSIONS` | `1536`, must match `EMBEDDING_DIMENSIONS` in the schema |
| `SITE_URL` | `https://getthereoneday.com`, used for Stripe redirect URLs |
| `XAI_MODEL`, `DEEPSEEK_MODEL` | Optional model overrides |

Set them on both the dev and production deployments.

## Deploying (Hostinger)

The site needs a build step, so Hostinger should track the **`deploy`** branch, not `main`.
`.github/workflows/deploy.yml` runs on every push to `main`: it deploys `convex/` to production,
builds the front end against it, and pushes `dist/` to `deploy`.

1. Add repository secrets: `CONVEX_DEPLOY_KEY` (Convex dashboard → production deployment →
   Settings → Deploy keys), `VITE_CLERK_PUBLISHABLE_KEY`, and optionally the PostHog pair.
2. Push to `main` once so the Action creates the `deploy` branch.
3. hPanel → **Websites → Manage → Advanced → GIT**: repository
   `https://github.com/Haystax101/gtod-site`, branch **`deploy`**, directory `public_html`.
4. Click **Deploy** once, then copy the **webhook URL** and add it in GitHub → repo
   **Settings → Webhooks** (push events) so every build auto-deploys.

## Hero phone video

`public/assets/reel.mp4` plays inside the phone frame on the landing page (iPhone 16 Pro
ratio, 1206 x 2622; other portrait sizes are cover-cropped). Replace the file to change it.
If it's missing the phone shows the logo instead.

## Analytics (PostHog)

Off until `VITE_POSTHOG_KEY` is set. Events: pageviews (including route changes),
`question_submitted`, `cv_template_copied`, `cover_letter_template_copied`,
`charge_message_sent`, `charge_document_uploaded`, `pro_checkout_started`, `pro_checkout_completed`.

## Question form

The ask section posts to [FormSubmit](https://formsubmit.co), which forwards to
`questions@getthereoneday.com` via the activated alias in the form's `action` URL.

## Links still to fill in

Search `src/pages/Home.jsx` for `TODO`: Spotify show URL, YouTube channel URL, Instagram handle.
