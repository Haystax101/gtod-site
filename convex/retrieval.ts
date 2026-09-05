/**
 * Chunking and retrieval for the GTOD knowledge base.
 *
 * Pure functions, no Convex imports, so they can be unit tested with
 * `node --experimental-strip-types`. Everything here is deterministic.
 *
 * Why retrieval exists at all: buildSystemPrompt used to concatenate every
 * enabled knowledge doc into the system prompt. At corpus scale that is ~137k
 * input tokens on every single message, which exhausts the Flash monthly cost
 * cap in about ten messages. Retrieving a handful of relevant chunks instead
 * keeps a message at roughly 6k tokens.
 */

// ---------------------------------------------------------------- types

export interface KnowledgeDoc {
  slug: string
  title: string
  content: string
}

export interface Chunk {
  slug: string
  docTitle: string
  heading: string
  /** Text as it will be shown to the model, including its heading path. */
  text: string
  /** Position of the chunk within its document, 0-based. */
  position: number
}

export interface ScoredChunk<T> {
  chunk: T
  score: number
}

// ---------------------------------------------------------------- tuning

/** Target chunk size in characters. Sections below this are kept whole. */
const TARGET_CHARS = 1400
/** Hard ceiling before a section is split on paragraph boundaries. */
const MAX_CHARS = 2200
/** Overlap carried between split parts, so a claim spanning a split survives. */
const OVERLAP_CHARS = 200

const BM25_K1 = 1.5
const BM25_B = 0.75
/** Terms in a chunk's heading count this many times extra when indexing. */
const HEADING_WEIGHT = 2

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','than','that','this','these','those',
  'is','are','was','were','be','been','being','am','do','does','did','doing',
  'have','has','had','having','i','you','he','she','it','we','they','me','him',
  'her','us','them','my','your','his','its','our','their','of','in','on','at',
  'to','for','with','from','by','as','into','about','over','under','between',
  'can','could','will','would','shall','should','may','might','must','not','no',
  'so','what','which','who','whom','when','where','why','how','all','any','both',
  'each','few','more','most','other','some','such','only','own','same','too','very',
])

// ---------------------------------------------------------------- text utils

/**
 * Split into lowercase terms. Deliberately simple: strip punctuation, drop
 * stopwords and single characters, and normalise the common plural so that
 * "apprenticeships" and "apprenticeship" match. Aggressive stemming would
 * conflate terms that matter here (for example "levy" and "level").
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9£+]+/)) {
    // Single digits are kept: "Level 6" and "Level 7" are distinctions that
    // matter enormously here, and dropping the digit collapses them together.
    if (raw.length < 2 && !/^[0-9]$/.test(raw)) continue
    if (STOPWORDS.has(raw)) continue
    let term = raw
    if (term.length > 4 && term.endsWith('ies')) term = term.slice(0, -3) + 'y'
    else if (term.length > 4 && term.endsWith('es') && !term.endsWith('ses')) term = term.slice(0, -2)
    else if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) term = term.slice(0, -1)
    out.push(term)
  }
  return out
}

/** Strip a leading YAML front-matter block, returning body and raw front matter. */
export function splitFrontMatter(content: string): { frontMatter: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content)
  if (!match) return { frontMatter: '', body: content }
  return { frontMatter: match[1], body: content.slice(match[0].length) }
}

/**
 * Pull `id -> url` out of a corpus document's `sources:` front matter.
 * Hand-rolled rather than a YAML dependency: the shape is fixed by
 * content/_meta/AUTHORING.md and Convex functions should stay dependency-light.
 */
export function parseSources(frontMatter: string): Map<string, string> {
  const sources = new Map<string, string>()
  if (!frontMatter.includes('sources:')) return sources
  let currentId = ''
  for (const line of frontMatter.split('\n')) {
    const id = /^\s*-\s+id:\s*(.+?)\s*$/.exec(line)
    if (id) {
      currentId = id[1].replace(/^["']|["']$/g, '')
      continue
    }
    const url = /^\s*url:\s*(.+?)\s*$/.exec(line)
    if (url && currentId) {
      sources.set(currentId, url[1].replace(/^["']|["']$/g, ''))
      currentId = ''
    }
  }
  return sources
}

/** Footnote ids actually cited in a piece of text, in order of appearance. */
function citedIds(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(/\[\^([A-Za-z0-9_-]+)\]/g)) seen.add(m[1])
  return [...seen]
}

// ---------------------------------------------------------------- chunking

/** Split a long section on paragraph boundaries, carrying a little overlap. */
function splitLongSection(body: string): string[] {
  const paragraphs = body.split(/\n{2,}/)
  const parts: string[] = []
  let buffer = ''

  for (const para of paragraphs) {
    if (buffer && buffer.length + para.length + 2 > TARGET_CHARS) {
      parts.push(buffer.trim())
      const tail = buffer.slice(-OVERLAP_CHARS)
      // Resume from a sentence boundary inside the overlap where possible.
      const resume = tail.slice(tail.search(/[.!?]\s|$/) + 1).trim()
      buffer = resume ? resume + '\n\n' + para : para
    } else {
      buffer = buffer ? buffer + '\n\n' + para : para
    }
  }
  if (buffer.trim()) parts.push(buffer.trim())
  return parts.length ? parts : [body.trim()]
}

/**
 * Split a knowledge document into retrievable chunks.
 *
 * Sections are cut at `##` headings because content/_meta/AUTHORING.md requires
 * each one to stand alone. Every chunk repeats the document title and its
 * heading, so a chunk retrieved without its neighbours still says what it is.
 * Footnote markers are resolved against the document's front matter and the
 * relevant URLs appended, so a chunk carries its own citations rather than
 * pointing at a `## Sources` block that was left behind in another chunk.
 */
export function chunkDocument(doc: KnowledgeDoc): Chunk[] {
  const { frontMatter, body } = splitFrontMatter(doc.content)
  const sources = parseSources(frontMatter)

  // Drop footnote definition lines; their URLs are re-attached per chunk below.
  const withoutDefs = body
    .split('\n')
    .filter((line) => !/^\[\^[A-Za-z0-9_-]+\]:/.test(line))
    .join('\n')

  // Both `##` and `###` start a new section. The playbook is written with `###`
  // as its top level, so splitting on `##` alone chunked it with no headings at
  // all - the retrievable unit has to follow the content, not an assumed depth.
  // An h3 keeps its parent h2 in the path so the chunk label stays meaningful.
  const sections: { heading: string; body: string }[] = []
  let h2 = ''
  let heading = ''
  let buffer: string[] = []
  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) sections.push({ heading, body: text })
    buffer = []
  }

  for (const line of withoutDefs.split('\n')) {
    const match = /^(#{2,3})\s+(.*)$/.exec(line)
    if (match) {
      flush()
      const title = match[2].trim()
      if (match[1] === '##') {
        h2 = title
        heading = title
      } else {
        heading = h2 ? `${h2} > ${title}` : title
      }
      continue
    }
    buffer.push(line)
  }
  flush()

  const chunks: Chunk[] = []
  for (const section of sections) {
    // A `## Sources` block is bookkeeping, not knowledge - never retrieve it.
    if (/(^|> )sources$/i.test(section.heading.trim())) continue

    const parts = section.body.length > MAX_CHARS ? splitLongSection(section.body) : [section.body]
    for (const part of parts) {
      const cited = citedIds(part)
        .map((id) => (sources.has(id) ? `[${id}] ${sources.get(id)}` : null))
        .filter((s): s is string => s !== null)

      const label = section.heading ? `${doc.title} - ${section.heading}` : doc.title
      const text = [
        label,
        '',
        part.trim(),
        ...(cited.length ? ['', 'Sources: ' + cited.join(' | ')] : []),
      ].join('\n')

      chunks.push({
        slug: doc.slug,
        docTitle: doc.title,
        heading: section.heading,
        text,
        position: chunks.length,
      })
    }
  }
  return chunks
}

// ---------------------------------------------------------------- scoring

/**
 * BM25 over the chunk set. The corpus is small enough (hundreds of chunks) to
 * score in memory on each query, which keeps retrieval dependency-free and
 * exactly reproducible. If the corpus grows past a few thousand chunks, move
 * this behind a Convex search index.
 */
export function bm25<T extends { text: string; heading?: string }>(
  query: string,
  chunks: T[],
): ScoredChunk<T>[] {
  const queryTerms = tokenize(query)
  if (!queryTerms.length || !chunks.length) return []

  const docTerms = chunks.map((c) => {
    const terms = tokenize(c.text)
    // Heading terms repeat, so a chunk whose heading matches the question wins
    // over one that merely mentions the words in passing.
    for (let i = 0; i < HEADING_WEIGHT; i++) terms.push(...tokenize(c.heading ?? ''))
    return terms
  })

  const N = chunks.length
  const avgdl = docTerms.reduce((sum, t) => sum + t.length, 0) / N || 1

  const df = new Map<string, number>()
  for (const terms of docTerms) {
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1)
  }

  const unique = [...new Set(queryTerms)]
  return chunks
    .map((chunk, i) => {
      const terms = docTerms[i]
      const len = terms.length || 1
      const tf = new Map<string, number>()
      for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1)

      let score = 0
      for (const term of unique) {
        const f = tf.get(term)
        if (!f) continue
        const n = df.get(term) ?? 0
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
        score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (len / avgdl))))
      }
      return { chunk, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * Reciprocal rank fusion of several ranked lists.
 *
 * Used to combine lexical and vector results. RRF needs only the rank, not the
 * scores, so BM25 scores and cosine similarities can be merged without trying
 * to make two incomparable scales agree.
 */
export function fuse<T>(rankings: T[][], key: (item: T) => string, k = 60): T[] {
  const scores = new Map<string, { item: T; score: number }>()
  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      const id = key(item)
      const entry = scores.get(id) ?? { item, score: 0 }
      entry.score += 1 / (k + index + 1)
      scores.set(id, entry)
    })
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).map((e) => e.item)
}

/**
 * Take chunks in rank order until the token budget is spent.
 *
 * `maxPerDoc` stops one long document crowding out every other source, which
 * matters when a question spans topics (pay and rights, say).
 */
export function selectChunks<T extends { text: string; slug: string }>(
  ranked: T[],
  { tokenBudget, maxPerDoc = 3 }: { tokenBudget: number; maxPerDoc?: number },
): T[] {
  const chosen: T[] = []
  const perDoc = new Map<string, number>()
  let used = 0

  for (const item of ranked) {
    const count = perDoc.get(item.slug) ?? 0
    if (count >= maxPerDoc) continue
    const cost = Math.ceil(item.text.length / 4)
    if (used + cost > tokenBudget) continue
    chosen.push(item)
    perDoc.set(item.slug, count + 1)
    used += cost
  }
  return chosen
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}
