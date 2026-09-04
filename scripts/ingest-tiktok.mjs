#!/usr/bin/env node
/**
 * Turn GTOD TikToks into knowledge base notes for Charge.
 *
 *   npm run ingest -- ~/Downloads/user_data_tiktok.json --limit 5 --dry-run
 *   npm run ingest -- ~/Downloads/user_data_tiktok.json
 *
 * How it works, and why:
 *
 * The TikTok data export does NOT contain video files or video ids. It contains
 * a signed CDN link per post that streams the file and expires about ten days
 * after the export. So:
 *
 *  - Audio is streamed straight out of that link by ffmpeg. No video is ever
 *    written to disk, and there is nothing to unzip.
 *  - Permanent post URLs come from a separate `yt-dlp` listing of the public
 *    profile. A TikTok video id encodes its creation time in its top 32 bits,
 *    which gives an exact join back to the export's timestamps.
 *  - Transcription runs locally through whisper.cpp, so nothing is uploaded.
 *  - A cheap model turns each transcript into a short titled note, which is
 *    upserted into `knowledge` and chunked into the retrieval index.
 *
 * Re-running is safe: notes are keyed on the video id, transcripts are cached,
 * and anything already in the knowledge base is skipped.
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const run = promisify(execFile)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '..')
const CACHE = join(ROOT, '.ingest-cache')
const TRANSCRIPTS = join(CACHE, 'transcripts')
const MODELS = join(CACHE, 'models')
const PROFILE_CACHE = join(CACHE, 'tiktok-profile.json')
const WORK = join(tmpdir(), 'gtod-ingest')

const WHISPER_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const HANDLE = 'getthereonedaypod'

/** Downloads are network-bound, so several run at once. */
const DOWNLOAD_CONCURRENCY = 6
/** Whisper already uses every core, so transcription stays serial. */
const BATCH = 6
const UPSERT_BATCH = 15
/** Seconds of slack when matching an export timestamp to a video id. */
const MATCH_TOLERANCE = 90

// macOS ships a CA bundle that the Python inside uvx does not pick up on its own.
const CERT_ENV = existsSync('/etc/ssl/cert.pem')
  ? { SSL_CERT_FILE: '/etc/ssl/cert.pem', REQUESTS_CA_BUNDLE: '/etc/ssl/cert.pem' }
  : {}

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const opts = {
  input: args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')),
  since: option('since', '2026-01-01'),
  dryRun: flag('dry-run'),
  force: flag('force'),
  prod: flag('prod'),
  limit: Number(option('limit', '0')) || 0,
  whisperModel: option('whisper-model', 'large-v3-turbo'),
  refreshProfile: flag('refresh-profile'),
  skipProfile: flag('no-links'),
}

const log = (...m) => console.log(...m)
const warn = (...m) => console.warn('  !', ...m)
const die = (m) => {
  console.error(`\nError: ${m}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The export: posts with a streamable link
// ---------------------------------------------------------------------------

function loadExport(path) {
  let doc
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    die(`could not read ${path} as JSON: ${err.message}`)
  }
  // The section has been called both "Post" and "Video" across export versions.
  const list =
    doc?.Post?.Posts?.VideoList ?? doc?.Video?.Videos?.VideoList ?? doc?.Post?.Post?.VideoList
  if (!Array.isArray(list)) {
    die('could not find a VideoList in that export. Is it the JSON export rather than TXT?')
  }
  return list
    .filter((p) => typeof p.Link === 'string' && p.Link.startsWith('http'))
    .filter((p) => (p.Date ?? '') >= opts.since)
    .map((p) => ({
      date: p.Date,
      // Treated as UTC. The join below re-checks that against the video ids and
      // will report a poor match rate if this assumption ever stops holding.
      ts: Date.parse(`${p.Date.replace(' ', 'T')}Z`) / 1000,
      link: p.Link,
      caption: p.Title && p.Title !== 'N/A' ? String(p.Title).trim() : '',
      sound: p.Sound ?? '',
    }))
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => b.ts - a.ts)
}

// ---------------------------------------------------------------------------
// Permanent links: the public profile, listed once and cached
// ---------------------------------------------------------------------------

async function loadProfile() {
  if (opts.skipProfile) return []
  if (existsSync(PROFILE_CACHE) && !opts.refreshProfile) {
    const cached = JSON.parse(readFileSync(PROFILE_CACHE, 'utf8'))
    return cached.entries ?? []
  }
  log(`Listing @${HANDLE} with yt-dlp to resolve permanent links (a few minutes)...`)
  try {
    const { stdout } = await run(
      'uvx',
      ['--quiet', '--with', 'curl_cffi', 'yt-dlp', '--flat-playlist', '-J', `https://www.tiktok.com/@${HANDLE}`],
      { maxBuffer: 512 * 1024 * 1024, env: { ...process.env, ...CERT_ENV } },
    )
    writeFileSync(PROFILE_CACHE, stdout)
    return JSON.parse(stdout).entries ?? []
  } catch (err) {
    warn(`could not list the profile (${err.message.slice(0, 120)})`)
    warn('continuing without permanent links; notes will be saved but not citable')
    return []
  }
}

/**
 * Attach a real video id to each post.
 *
 * A TikTok video id is a 64-bit value whose top 32 bits are the creation time,
 * so `id >> 32` recovers the exact second a post went up. Matching that against
 * the export's timestamps is far more reliable than matching on filenames.
 */
function attachVideoIds(posts, entries) {
  const byTime = entries
    .map((e) => String(e.id ?? ''))
    .filter((id) => /^\d{15,25}$/.test(id))
    .map((id) => ({ id, ts: Number(BigInt(id) >> 32n) }))
    .sort((a, b) => a.ts - b.ts)
  if (!byTime.length) return { matched: 0 }

  const times = byTime.map((e) => e.ts)
  const nearest = (ts) => {
    let lo = 0
    let hi = times.length - 1
    let best = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const d = times[mid] - ts
      if (best === null || Math.abs(d) < Math.abs(times[best] - ts)) best = mid
      if (d < 0) lo = mid + 1
      else hi = mid - 1
    }
    return best
  }

  const used = new Set()
  let matched = 0
  for (const post of posts) {
    const i = nearest(post.ts)
    if (i === null) continue
    const cand = byTime[i]
    if (Math.abs(cand.ts - post.ts) <= MATCH_TOLERANCE && !used.has(cand.id)) {
      used.add(cand.id)
      post.videoId = cand.id
      post.url = `https://www.tiktok.com/@${HANDLE}/video/${cand.id}`
      matched++
    }
  }
  return { matched }
}

// ---------------------------------------------------------------------------
// Audio and transcription, both local
// ---------------------------------------------------------------------------

async function ensureWhisperModel(name) {
  mkdirSync(MODELS, { recursive: true })
  const path = join(MODELS, `ggml-${name}.bin`)
  if (existsSync(path)) return path
  log(`Downloading whisper model "${name}" (one-off)...`)
  await run('curl', ['-fL', '--progress-bar', '-o', path, `${WHISPER_BASE_URL}/ggml-${name}.bin`], {
    stdio: 'inherit',
    maxBuffer: 1024 * 1024 * 1024,
  }).catch((e) => {
    rmSync(path, { force: true })
    die(`could not download the whisper model: ${e.message}`)
  })
  return path
}

/**
 * Get 16 kHz mono audio for a post, as small a download as possible.
 *
 * The export's CDN link serves the ORIGINAL upload, tens of megabytes each,
 * because that is what a data export is for. Pulling ~1500 of those is tens of
 * gigabytes and many hours. The public post has a separate compressed audio
 * track, roughly 2 MB, so yt-dlp fetches that instead: same speech, a fraction
 * of the bytes. The export link stays as the fallback for the handful of posts
 * that never matched a public video id.
 */
async function fetchAudio(post, index) {
  mkdirSync(WORK, { recursive: true })
  const wav = join(WORK, `clip-${index}.wav`)

  if (post.url) {
    const stem = join(WORK, `dl-${index}`)
    try {
      await run(
        'uvx',
        ['--quiet', '--with', 'curl_cffi', 'yt-dlp', '-f', 'ba/worst', '--no-playlist',
         '--no-progress', '-o', `${stem}.%(ext)s`, post.url],
        { maxBuffer: 32 * 1024 * 1024, timeout: 180_000, env: { ...process.env, ...CERT_ENV } },
      )
      const got = readdirSync(WORK).find((f) => f.startsWith(`dl-${index}.`))
      if (got) {
        const src = join(WORK, got)
        await run('ffmpeg', ['-loglevel', 'error', '-i', src, '-vn', '-ar', '16000', '-ac', '1',
          '-c:a', 'pcm_s16le', wav, '-y'], { maxBuffer: 32 * 1024 * 1024 })
        rmSync(src, { force: true })
        return wav
      }
    } catch {
      // Fall through to the export link.
    }
  }

  await run(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-user_agent', 'Mozilla/5.0',
      '-i', post.link,
      '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
      wav, '-y',
    ],
    { maxBuffer: 32 * 1024 * 1024, timeout: 300_000 },
  )
  return wav
}

/**
 * Transcribe a whole batch in one whisper-cli call.
 *
 * The large model is 1.5 GB and is loaded fresh on every invocation, which at
 * one call per video cost more than the transcription itself. Passing the batch
 * together loads it once. Output goes to a .txt beside each input rather than
 * stdout, which is the only way to tell the results apart.
 *
 * Returns a Map of wav path -> transcript, omitting any that produced nothing.
 */
async function transcribeBatch(wavs, modelPath) {
  const out = new Map()
  if (!wavs.length) return out
  try {
    await run(
      'whisper-cli',
      ['-m', modelPath, '-l', 'en', '-nt', '-np', '-t', '8', '-otxt', ...wavs],
      { maxBuffer: 128 * 1024 * 1024, timeout: 900_000 },
    )
  } catch (err) {
    warn(`whisper failed on a batch: ${String(err.message).slice(0, 120)}`)
  }
  for (const wav of wavs) {
    // whisper-cli writes "<input>.txt", keeping the original extension.
    const txt = `${wav}.txt`
    if (existsSync(txt)) {
      const text = readFileSync(txt, 'utf8').replace(/\s+/g, ' ').trim()
      rmSync(txt, { force: true })
      if (text) out.set(wav, text)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Convex, through the CLI so it reuses the existing login
// ---------------------------------------------------------------------------

async function convexRun(fn, argsObj) {
  const cli = ['convex', 'run', fn, JSON.stringify(argsObj ?? {})]
  if (opts.prod) cli.push('--prod')
  const { stdout } = await run('npx', cli, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  const text = stdout.trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ---------------------------------------------------------------------------
// Summarising
// ---------------------------------------------------------------------------

function readEnv(name) {
  if (process.env[name]) return process.env[name]
  const envPath = join(ROOT, '.env.local')
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim()
  }
  try {
    const out = execFileSync('npx', ['convex', 'env', 'get', name, ...(opts.prod ? ['--prod'] : [])], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

const NOTE_PROMPT = `You turn transcripts of short-form videos into notes for a knowledge base.

The videos are from Get There One Day (GTOD), a UK community run by Charlie and George that helps 16-19 year olds with degree apprenticeships, uni and early careers. The notes will be read by an AI assistant answering students' questions, so they must be dense with the actual advice and free of filler.

Given a transcript (auto-generated, so expect the odd mis-heard word), reply with JSON:
{
  "useful": true or false,
  "title": "short specific title, max 8 words",
  "notes": "the advice as markdown: a one-line summary then bullet points",
  "tags": ["two to four lowercase topic tags"]
}

Rules:
- "useful" is false when the video has no advice or information worth keeping for that audience: pure banter, a trend or dance, a promo with no substance, or a transcript too garbled to use. Be reasonably generous, but this account posts a lot of non-careers content and none of that belongs in the knowledge base.
- The title says what the video is about, not "GTOD video about X".
- Notes must preserve specifics: numbers, company names, deadlines, exact phrasings they recommend. Drop greetings, sign-offs, "follow for more", and repetition.
- Keep the speaker's opinions as opinions ("we think", "we'd avoid"), because the assistant speaks as GTOD.
- Write British English. 60 to 200 words of notes for a normal video.
- Tags come from this vocabulary where they fit: cv, cover-letter, interview, assessment-centre, work-experience, psychometric-tests, applications, uni, apprenticeships, money, mindset, day-in-the-life.
- Reply with the JSON object only.`

async function callModel(api, caption, transcript, maxTokens) {
  const res = await fetch(api.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api.key}`,
      'HTTP-Referer': 'https://getthereoneday.com',
      'X-Title': 'Charge by Get There One Day',
    },
    body: JSON.stringify({
      model: api.model,
      temperature: 0.3,
      max_tokens: maxTokens,
      // Mechanical summarising, so private reasoning only cost latency and tokens.
      reasoning: { enabled: false },
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: NOTE_PROMPT },
        { role: 'user', content: `Caption: ${caption || '(none)'}\n\nTranscript:\n${transcript}` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const choice = json.choices?.[0]
  return { raw: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' }
}

/**
 * The Flash model spends tokens on internal reasoning before it answers, and
 * those count against max_tokens. Too small a budget truncates the JSON
 * mid-string, so start generous and retry once with more room.
 */
async function summarise(api, { caption, transcript }) {
  for (const budget of [2000, 3500]) {
    const { raw, truncated } = await callModel(api, caption, transcript, budget)
    const cleaned = raw.replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
    if (!truncated && cleaned) {
      try {
        return JSON.parse(cleaned)
      } catch {
        // Fall through and retry with a larger budget.
      }
    }
  }
  throw new Error('model did not return usable JSON')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!opts.input || flag('help')) {
    log(`
Usage: npm run ingest -- <user_data_tiktok.json> [options]

  --since YYYY-MM-DD     only posts on or after this date (default 2026-01-01)
  --limit N              only process N new videos
  --dry-run              transcribe and summarise, but write nothing to Convex
  --force                re-ingest videos already in the knowledge base
  --prod                 target the production deployment
  --whisper-model NAME   default large-v3-turbo. Do not drop to small.en: it
                         silently skipped ~10% of one test video, losing two
                         whole entries from a ranking, and turbo is faster
                         than medium.en anyway.
  --refresh-profile      re-list the public profile instead of using the cache
  --no-links             skip the profile listing; notes get no citable URL
`)
    process.exit(0)
  }

  for (const bin of ['ffmpeg', 'whisper-cli']) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' })
    } catch {
      die(`${bin} is not installed. Try: brew install ffmpeg whisper-cpp`)
    }
  }

  const key = readEnv('OPENROUTER_API_KEY')
  if (!key) die('no OPENROUTER_API_KEY in the environment, .env.local, or the Convex deployment')
  const api = {
    key,
    url: process.env.INGEST_API_URL ?? OPENROUTER_URL,
    model: readEnv('OPENROUTER_MODEL_FLASH') ?? 'deepseek/deepseek-v4-flash-0731',
  }

  const posts = loadExport(resolve(opts.input))
  log(`${posts.length} posts on or after ${opts.since}`)
  if (!posts.length) die('nothing to do for that date range')

  const entries = await loadProfile()
  const { matched } = attachVideoIds(posts, entries)
  log(`${matched} of ${posts.length} matched to a permanent link`)
  if (entries.length && matched < posts.length * 0.5) {
    warn('most posts did not match a video id; links will be missing for those')
  }

  // The video id is the dedupe key. Without one, fall back to the timestamp so
  // a re-run still recognises the post rather than duplicating it.
  for (const p of posts) p.sourceId = p.videoId ?? `t${Math.round(p.ts)}`

  const already = opts.force ? [] : ((await convexRun('knowledge:ingestedSourceIds', { sourceType: 'tiktok' })) ?? [])
  const seen = new Set(already)
  let todo = posts.filter((p) => !seen.has(p.sourceId))
  log(`${seen.size} already ingested, ${todo.length} to do`)
  if (opts.limit) todo = todo.slice(0, opts.limit)
  if (!todo.length) {
    log('\nNothing to do.')
    return
  }

  const modelPath = await ensureWhisperModel(opts.whisperModel)
  mkdirSync(TRANSCRIPTS, { recursive: true })
  rmSync(WORK, { recursive: true, force: true })

  let pending = []
  const writtenSlugs = []
  let done = 0
  let skipped = 0
  let failed = 0

  const flush = async () => {
    if (opts.dryRun || !pending.length) {
      pending = []
      return
    }
    const batch = pending
    pending = []
    const result = await convexRun('knowledge:upsertVideoNotes', { notes: batch })
    if (result?.slugs) writtenSlugs.push(...result.slugs)
    log(`  saved ${batch.length} notes`)
  }

  // Download several clips at once, then transcribe them one at a time: the
  // network likes concurrency, whisper already uses every core.
  for (let i = 0; i < todo.length; i += BATCH) {
    const group = todo.slice(i, i + BATCH)
    const needAudio = group.filter((p) => !existsSync(join(TRANSCRIPTS, `${p.sourceId}.txt`)))

    const audio = new Map()
    for (let j = 0; j < needAudio.length; j += DOWNLOAD_CONCURRENCY) {
      const slice = needAudio.slice(j, j + DOWNLOAD_CONCURRENCY)
      await Promise.all(
        slice.map(async (post, k) => {
          try {
            audio.set(post.sourceId, await fetchAudio(post, j + k))
          } catch (err) {
            warn(`${post.date}: download failed (${String(err.message).slice(0, 80)})`)
          }
        }),
      )
    }

    // One whisper call for the whole batch, then clean the audio up.
    const transcripts = await transcribeBatch([...audio.values()], modelPath)
    for (const wav of audio.values()) rmSync(wav, { force: true })

    // Resolve each post's transcript, from cache or from this batch.
    const ready = []
    for (const post of group) {
      const cachePath = join(TRANSCRIPTS, `${post.sourceId}.txt`)
      let transcript = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : null
      if (!transcript) {
        const wav = audio.get(post.sourceId)
        transcript = wav ? transcripts.get(wav) : null
        if (transcript) writeFileSync(cachePath, transcript)
      }
      ready.push({ post, transcript })
    }

    // Summarising is a network round trip each, so the batch goes out together
    // rather than one at a time.
    const notes = await Promise.all(
      ready.map(async ({ post, transcript }) => {
        if (!transcript) return { post, error: 'no transcript produced' }
        if (transcript.length < 40) return { post, quiet: true }
        try {
          return { post, note: await summarise(api, { caption: post.caption, transcript }) }
        } catch (err) {
          return { post, error: String(err.message).slice(0, 140) }
        }
      }),
    )

    for (const { post, note, error, quiet } of notes) {
      done++
      const label = `[${done}/${todo.length}] ${post.date}`
      try {
        if (error) {
          warn(`${post.date}: ${error}`)
          failed++
          continue
        }
        if (quiet) {
          log(`${label} almost no speech, skipped`)
          skipped++
          continue
        }
        if (!note.useful) {
          log(`${label} not careers content, skipped`)
          skipped++
          continue
        }
        log(`${label} ${note.title}`)
        pending.push({
          sourceId: post.sourceId,
          title: String(note.title).slice(0, 120),
          content: String(note.notes),
          sourceUrl: post.url ?? undefined,
          sourceTitle: post.caption || undefined,
          postedAt: Math.round(post.ts * 1000),
          tags: Array.isArray(note.tags) ? note.tags.slice(0, 6).map(String) : undefined,
        })
        if (pending.length >= UPSERT_BATCH) await flush()
      } catch (err) {
        warn(`${post.date}: ${String(err.message).slice(0, 140)}`)
        failed++
      }
    }
  }
  await flush()

  // Chunk and embed only what changed, so retrieval picks the new notes up.
  if (!opts.dryRun && writtenSlugs.length) {
    log(`\nIndexing ${writtenSlugs.length} notes for retrieval...`)
    for (let i = 0; i < writtenSlugs.length; i += 40) {
      const slugs = writtenSlugs.slice(i, i + 40)
      try {
        await convexRun('knowledge:reindex', { slugs })
      } catch (err) {
        warn(`reindex failed for a batch: ${String(err.message).slice(0, 120)}`)
      }
    }
  }

  rmSync(WORK, { recursive: true, force: true })
  log(`\nDone. ${writtenSlugs.length} notes saved, ${skipped} skipped, ${failed} failed.`)
  if (opts.dryRun) log('(dry run: nothing was written)')
}

main().catch((err) => die(err.stack ?? err.message))
