# Get There One Day — Landing Site

Single-page landing site for **Get There One Day** — the community for ambitious young
people at uni, at school, at work, and building their own thing (degree apprentices
especially welcome). 11K+ strong on TikTok, with a 100% Q&A podcast on Spotify & YouTube.

## Structure

- `index.html` — the whole site (styles inlined, no build step)
- `assets/logo.png` — the GTOD circular logo (also used as favicon)

## Deploying (Hostinger, tracking this repo)

1. hPanel → **Websites → Manage → Advanced → GIT**
2. Repository: `https://github.com/Haystax101/gtod-site`, branch `main`, directory `public_html`
3. Click **Deploy** once, then copy the **webhook URL** Hostinger shows and add it in
   GitHub → repo **Settings → Webhooks** so every push auto-deploys

(Alternative: GitHub Pages — Settings → Pages → deploy from `main` / root.)

## Question form

The ask section posts to [FormSubmit](https://formsubmit.co), which forwards
submissions to `questions@getthereoneday.com`. **One-time activation:** submit a
test question on the live site, then click the confirmation link FormSubmit emails
to that inbox. Every question after that lands straight in the inbox.

## Links still to fill in

Search `index.html` for `TODO`:

- Spotify show URL
- YouTube channel URL (currently `@getthereoneday`)
- Instagram handle (currently `@getthereoneday`; TikTok is confirmed as `@getthereonedaypod`)
