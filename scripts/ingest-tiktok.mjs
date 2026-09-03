#!/usr/bin/env node
/**
 * Turn GTOD TikToks into knowledge base notes for Charge.
 *
 *   npm run ingest -- ~/Downloads/TikTok_Data.zip
 *   npm run ingest -- ~/Downloads/TikTok_Data          (already unzipped)
 *   npm run ingest -- ~/Downloads/TikTok_Data.zip --dry-run --limit 3
 *
 * For each video it extracts the audio, transcribes it locally with whisper.cpp
 * (free, nothing leaves the machine), asks a cheap model to turn the transcript
 * into a short titled note, and upserts that into the `knowledge` table with a
 * link back to the original post.
 *
 * Videos are pulled out of the zip ONE AT A TIME and deleted straight after, so
 * a 20 GB export never needs 20 GB of free space. Videos already in the
 * knowledge base are skipped, so re-running on a fresh full export is cheap.
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
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
const WORK = join(tmpdir(), 'gtod-ingest')

const WHISPER_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v'])
const UPSERT_BATCH = 15
// Override the chat endpoint, used by the test harness.
const API_URL = process.env.INGEST_API_URL || null

const args = process.argv.slice(2)
const flag = (name, fallback = false) => (args.includes(`--${name}`) ? true : fallback)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const opts = {
  input: args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')),
  dryRun: flag('dry-run'),
  force: flag('force'),
  prod: flag('prod'),
  limit: Number(option('limit', '0')) || 0,
  whisperModel: option('whisper-model', 'small.en'),
  keepTranscripts: !flag('no-cache'),
}

const log = (...m) => console.log(...m)
const warn = (...m) => console.warn('  !', ...m)
const die = (m) => {
  console.error(`\nError: ${m}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Zip / folder access. `list` gives relative paths, `read` pulls one file out.
// ---------------------------------------------------------------------------

function openSource(input) {
  if (!existsSync(input)) die(`${input} does not exist`)
  const isZip = statSync(input).isFile() && extname(input).toLowerCase() === '.zip'

  if (!isZip) {
    const walk = (dir, prefix = '') =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
      )
    return {
      kind: 'folder',
      list: () => walk(input),
      readText: (path) => readFileSync(join(input, path), 'utf8'),
      // Already on disk: hand back the real path, nothing to clean up.
      extract: (path) => ({ path: join(input, path), cleanup: () => {} }),
    }
  }

  return {
    kind: 'zip',
    list: () =>
      execFileSync('unzip', ['-Z1', input], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.endsWith('/')),
    readText: (path) => execFileSync('unzip', ['-p', input, path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
    // Pull a single file into a temp dir so disk usage stays flat.
    extract: (path) => {
      mkdirSync(WORK, { recursive: true })
      execFileSync('unzip', ['-o', '-j', input, path, '-d', WORK], { stdio: 'ignore' })
      const out = join(WORK, basename(path))
      return { path: out, cleanup: () => rmSync(out, { force: true }) }
    },
  }
}

// ---------------------------------------------------------------------------
// Manifest: pull post links, captions and dates out of the export JSON.
// The export's shape changes between versions, so rather than hard-coding a
// path we walk the whole document looking for anything that has a video link.
// ---------------------------------------------------------------------------

const idFromUrl = (url) => (String(url).match(/(\d{15,25})/) || [])[1] ?? null
const idFromFilename = (name) => (basename(name).match(/(\d{15,25})/) || [])[1] ?? null

function buildManifest(source) {
  const jsonFiles = source.list().filter((f) => f.toLowerCase().endsWith('.json'))
  const posts = new Map()

  for (const file of jsonFiles) {
    let doc
    try {
      doc = JSON.parse(source.readText(file))
    } catch {
      continue
    }
    walk(doc)
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)

    const link = node.Link ?? node.link ?? node.VideoLink ?? node.url
    const id = link ? idFromUrl(link) : null
    if (id && !posts.has(id)) {
      const dateRaw = node.Date ?? node.date ?? node.CreateTime
      const parsed = dateRaw ? Date.parse(String(dateRaw).replace(' ', 'T') + 'Z') : NaN
      posts.set(id, {
        id,
        url: String(link),
        caption: String(node.Title ?? node.title ?? node.Caption ?? node.Description ?? '').trim(),
        postedAt: Number.isNaN(parsed) ? undefined : parsed,
      })
    }
    Object.values(node).forEach(walk)
  }

  return posts
}

// Pair each video file with its manifest entry. Matching on the id embedded in
// the filename works for current exports; when that fails we fall back to the
// post date, and failing that we still ingest, just without a link.
function pairVideos(source, manifest) {
  const files = source.list().filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()))
  const byDate = new Map()
  for (const post of manifest.values()) {
    if (post.postedAt) {
      const key = new Date(post.postedAt).toISOString().slice(0, 10)
      if (!byDate.has(key)) byDate.set(key, [])
      byDate.get(key).push(post)
    }
  }
  const usedByDate = new Set()

  return files.map((file) => {
    const id = idFromFilename(file)
    if (id && manifest.has(id)) return { file, post: manifest.get(id) }

    const dateMatch = basename(file).match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/)
    if (dateMatch) {
      const key = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      const candidate = (byDate.get(key) ?? []).find((p) => !usedByDate.has(p.id))
      if (candidate) {
        usedByDate.add(candidate.id)
        return { file, post: candidate }
      }
    }

    // No manifest entry. Key on the filename so repeat runs still dedupe.
    return { file, post: { id: id ?? `file-${basename(file, extname(file))}`, url: null, caption: '', postedAt: undefined } }
  })
}

// ---------------------------------------------------------------------------
// Transcription (whisper.cpp, local)
// ---------------------------------------------------------------------------

async function ensureWhisperModel(name) {
  mkdirSync(MODELS, { recursive: true })
  const path = join(MODELS, `ggml-${name}.bin`)
  if (existsSync(path)) return path
  log(`Downloading whisper model "${name}" (one-off, a few hundred MB)...`)
  await run('curl', ['-fL', '--progress-bar', '-o', path, `${WHISPER_BASE_URL}/ggml-${name}.bin`], {
    stdio: 'inherit',
    maxBuffer: 1024 * 1024 * 1024,
  }).catch((e) => {
    rmSync(path, { force: true })
    die(`could not download the whisper model: ${e.message}`)
  })
  return path
}

async function transcribe(videoPath, modelPath) {
  mkdirSync(WORK, { recursive: true })
  const wav = join(WORK, `${Date.now()}.wav`)
  try {
    await run('ffmpeg', ['-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav, '-y'], {
      maxBuffer: 32 * 1024 * 1024,
    })
    const { stdout } = await run(
      'whisper-cli',
      ['-m', modelPath, '-f', wav, '-l', 'en', '-nt', '-np', '-t', '8'],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    return stdout.replace(/\s+/g, ' ').trim()
  } finally {
    rmSync(wav, { force: true })
  }
}

// ---------------------------------------------------------------------------
// Convex (via the CLI, so it reuses your existing login and no key is needed)
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
// Summarising a transcript into a note
// ---------------------------------------------------------------------------

function readApiKey() {
  const envPath = join(ROOT, '.env.local')
  const fromFile = (name) => {
    if (!existsSync(envPath)) return null
    const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim() : null
  }
  const fromConvex = (name) => {
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
  const key = process.env.OPENROUTER_API_KEY ?? fromFile('OPENROUTER_API_KEY') ?? fromConvex('OPENROUTER_API_KEY')
  if (!key) return null
  return {
    key,
    url: API_URL ?? 'https://openrouter.ai/api/v1/chat/completions',
    // Summarising is easy work, so it uses the cheaper of the two tier models.
    model:
      process.env.OPENROUTER_MODEL_FLASH ??
      fromConvex('OPENROUTER_MODEL_FLASH') ??
      'deepseek/deepseek-v4-flash-0731',
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
- "useful" is false only if the video contains no advice or information worth keeping (pure banter, a promo with no substance, or a transcript too garbled to use). Be generous: anything with a real tip, opinion, statistic or story is useful.
- The title says what the video is about, not "GTOD video about X".
- Notes must preserve specifics: numbers, company names, deadlines, exact phrasings they recommend. Drop greetings, sign-offs, "follow for more", and repetition.
- Keep the speaker's opinions as opinions ("we think", "we'd avoid"), because the assistant speaks as GTOD.
- Write British English. 60 to 200 words of notes for a normal video.
- Tags come from this vocabulary where they fit: cv, cover-letter, interview, assessment-centre, work-experience, psychometric-tests, applications, uni, apprenticeships, money, mindset, day-in-the-life.
- Reply with the JSON object only.`

async function summarise(api, { caption, transcript }) {
  const body = {
    model: api.model,
    temperature: 0.3,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: NOTE_PROMPT },
      {
        role: 'user',
        content: `Caption: ${caption || '(none)'}\n\nTranscript:\n${transcript}`,
      },
    ],
  }
  const res = await fetch(api.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.key}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const raw = json.choices?.[0]?.message?.content ?? ''
  const cleaned = raw.replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
  return JSON.parse(cleaned)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!opts.input || flag('help')) {
    log(`
Usage: npm run ingest -- <TikTok export zip or folder> [options]

  --dry-run              transcribe and summarise, but don't write to Convex
  --limit N              only process N new videos (good for a first test)
  --force                re-ingest videos already in the knowledge base
  --prod                 target the production deployment instead of dev
  --whisper-model NAME   default small.en; base.en is ~3x faster, tiny.en faster still
  --no-cache             don't keep transcripts in .ingest-cache
`)
    process.exit(0)
  }

  for (const bin of ['ffmpeg', 'whisper-cli', 'unzip']) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' })
    } catch {
      die(`${bin} is not installed. Try: brew install ffmpeg whisper-cpp`)
    }
  }

  const api = readApiKey()
  if (!api) die('no OPENROUTER_API_KEY found in the environment, .env.local, or the Convex deployment')
  log(`Summarising with ${api.model}`)

  const source = openSource(resolve(opts.input))
  log(`Reading ${source.kind}: ${opts.input}`)

  const manifest = buildManifest(source)
  const paired = pairVideos(source, manifest)
  if (paired.length === 0) die('found no video files in there')
  log(`Found ${paired.length} videos, ${manifest.size} posts in the export metadata`)

  const already = opts.force ? [] : ((await convexRun('knowledge:ingestedSourceIds', { sourceType: 'tiktok' })) ?? [])
  const seen = new Set(already)
  let todo = paired.filter((p) => !seen.has(p.post.id))
  log(`${seen.size} already in the knowledge base, ${todo.length} new`)
  if (opts.limit) todo = todo.slice(0, opts.limit)
  if (todo.length === 0) {
    log('\nNothing to do.')
    return
  }

  const modelPath = await ensureWhisperModel(opts.whisperModel)
  mkdirSync(TRANSCRIPTS, { recursive: true })

  const notes = []
  let skipped = 0
  let failed = 0

  for (const [i, { file, post }] of todo.entries()) {
    const label = `[${i + 1}/${todo.length}] ${basename(file)}`
    const cachePath = join(TRANSCRIPTS, `${post.id}.txt`)
    try {
      let transcript = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : null
      if (transcript) {
        log(`${label} transcript cached`)
      } else {
        process.stdout.write(`${label} transcribing... `)
        const { path, cleanup } = source.extract(file)
        try {
          transcript = await transcribe(path, modelPath)
        } finally {
          cleanup()
        }
        process.stdout.write(`${transcript.split(' ').length} words\n`)
        if (opts.keepTranscripts) writeFileSync(cachePath, transcript)
      }

      if (transcript.length < 40) {
        warn('almost no speech, skipping')
        skipped++
        continue
      }

      const note = await summarise(api, { caption: post.caption, transcript })
      if (!note.useful) {
        warn(`no usable advice: "${note.title ?? ''}"`)
        skipped++
        continue
      }
      log(`  -> ${note.title}`)
      notes.push({
        sourceId: post.id,
        title: String(note.title).slice(0, 120),
        content: String(note.notes),
        sourceUrl: post.url ?? undefined,
        sourceTitle: post.caption || undefined,
        postedAt: post.postedAt,
        tags: Array.isArray(note.tags) ? note.tags.slice(0, 6).map(String) : undefined,
      })
    } catch (err) {
      warn(`${basename(file)}: ${err.message}`)
      failed++
    }

    if (!opts.dryRun && notes.length >= UPSERT_BATCH) {
      await flushNotes(notes.splice(0, notes.length))
    }
  }

  if (!opts.dryRun && notes.length) await flushNotes(notes)

  rmSync(WORK, { recursive: true, force: true })
  log(`\nDone. ${skipped} skipped, ${failed} failed.`)
  if (opts.dryRun) log('(dry run: nothing was written to Convex)')
  else log(`Check them with: npx convex run knowledge:list${opts.prod ? ' --prod' : ''}`)
}

async function flushNotes(batch) {
  const result = await convexRun('knowledge:upsertVideoNotes', { notes: batch })
  log(`  saved ${batch.length} notes (${JSON.stringify(result)})`)
}

main().catch((err) => die(err.stack ?? err.message))
