/**
 * Tests for convex/retrieval.ts, run against the real playbook and the real
 * corpus drafts rather than toy fixtures.
 *
 *   node --experimental-strip-types tools/corpus/retrieval.test.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  bm25, chunkDocument, cosineSimilarity, fuse,
  parseSources, selectChunks, splitFrontMatter, tokenize,
} from '../../convex/retrieval.ts'
import { PLAYBOOK } from '../../convex/content/playbook.ts'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`) }
}

console.log('\ntokenize')
{
  const t = tokenize('The apprenticeships are, in fact, LEVEL 6!')
  check('drops stopwords', !t.includes('the') && !t.includes('are') && !t.includes('in'))
  check('normalises plural', t.includes('apprenticeship'), t.join(','))
  check('keeps digits', t.includes('6'), t.join(','))
  check('does not conflate levy with level',
    tokenize('levy')[0] !== tokenize('level')[0],
    `${tokenize('levy')[0]} vs ${tokenize('level')[0]}`)
  check('handles currency', tokenize('it costs £9790 a year').includes('£9790'))
}

console.log('\nfront matter and sources')
{
  const draft = readFileSync(
    'content/apprenticeships/00-foundations/apprentice-minimum-wage.md', 'utf8')
  const { frontMatter, body } = splitFrontMatter(draft)
  check('front matter extracted', frontMatter.includes('sources:'))
  check('body excludes front matter', !body.startsWith('---'))
  const sources = parseSources(frontMatter)
  check('sources parsed', sources.size > 0, `got ${sources.size}`)
  check('source urls look like urls',
    [...sources.values()].every((u) => u.startsWith('http')),
    [...sources.values()][0])
}

console.log('\nchunking the real playbook')
{
  const chunks = chunkDocument(PLAYBOOK)
  check('produces chunks', chunks.length > 0, `${chunks.length}`)
  check('every chunk names its document', chunks.every((c) => c.text.includes(PLAYBOOK.title)))
  check('every chunk is non-trivial', chunks.every((c) => c.text.length > 50))
  check('no chunk is enormous', chunks.every((c) => c.text.length < 3000),
    `max ${Math.max(...chunks.map((c) => c.text.length))}`)
  check('headings captured', chunks.some((c) => /assessment centre/i.test(c.heading)),
    chunks.map((c) => c.heading).join(' | ').slice(0, 120))
}

console.log('\nchunking a cited corpus document')
{
  const raw = readFileSync(
    'content/apprenticeships/00-foundations/apprentice-minimum-wage.md', 'utf8')
  const chunks = chunkDocument({ slug: 'pay', title: 'Apprentice pay', content: raw })
  check('produces chunks', chunks.length > 2, `${chunks.length}`)
  check('excludes the Sources section',
    !chunks.some((c) => /^sources$/i.test(c.heading)))
  check('no footnote definition lines leak in',
    !chunks.some((c) => /^\[\^[a-z0-9]+\]:/im.test(c.text)))
  const withCites = chunks.filter((c) => c.text.includes('Sources: '))
  check('citations re-attached to chunks that cite', withCites.length > 0,
    `${withCites.length}/${chunks.length}`)
  check('re-attached citations carry urls',
    withCites.every((c) => /Sources: .*http/.test(c.text)))
}

console.log('\nbm25 ranking over the whole verified corpus')
{
  const dir = 'content/apprenticeships'
  const files: string[] = []
  for (const sub of readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue
    for (const f of readdirSync(join(dir, sub.name))) {
      if (f.endsWith('.md')) files.push(join(dir, sub.name, f))
    }
  }
  const all = [
    // The playbook is part of the real index - CV and interview advice lives
    // there, not in the sourced documents, so omitting it made the CV query
    // unanswerable. Fixtures are the verified corpus, so this exercises exactly
    // what ships rather than a set of drafts that can be retired underneath it.
    ...chunkDocument(PLAYBOOK),
    ...files.flatMap((f) =>
      chunkDocument({
        slug: f.split('/').pop()!.replace('.md', ''),
        title: f.split('/').pop()!.replace('.md', '').replace(/-/g, ' '),
        content: readFileSync(f, 'utf8'),
      })),
  ]
  console.log(`  (indexed ${all.length} chunks from ${files.length} documents)`)
  check('corpus chunked', all.length > 50, `${all.length}`)

  const ranked = bm25('how much do apprentices get paid per hour', all)
  check('returns results', ranked.length > 0)
  check('scores descend', ranked.every((r, i) => i === 0 || ranked[i - 1].score >= r.score))
  const topSlugs = ranked.slice(0, 5).map((r) => r.chunk.slug)
  // Asserts the wage document is in the retrieved set, not that it ranks first.
  // It currently sits around 5th: apprentice-rights and the legal-definition
  // document both discuss pay at length, so lexical scoring cannot separate the
  // dedicated source from the passing mentions. Since selectChunks sends the top
  // several chunks, the right answer still reaches the model - but this is the
  // clearest example in the suite of why embeddings are worth configuring.
  check('pay question retrieves the wage document',
    topSlugs.some((s) => s.includes('minimum-wage')), topSlugs.join(', '))

  const cv = bm25('what should I put on my CV with no work experience', all)
  check('cv question retrieves the playbook CV guidance',
    /cv/i.test(cv[0]?.chunk.heading ?? '') || cv[0]?.chunk.slug === PLAYBOOK.slug,
    `${cv[0]?.chunk.slug} / ${cv[0]?.chunk.heading}`)
  check('level 6 and level 7 rank differently',
    bm25('level 6 degree apprenticeship', all)[0]?.chunk.text !==
    bm25('level 7 masters apprenticeship', all)[0]?.chunk.text)

  check('nonsense query returns nothing', bm25('zzzzq xxxyw', all).length === 0)
  check('empty query returns nothing', bm25('', all).length === 0)

  console.log('\nbudget selection')
  const picked = selectChunks(ranked.map((r) => r.chunk), { tokenBudget: 1500, maxPerDoc: 2 })
  const tokens = picked.reduce((n, c) => n + Math.ceil(c.text.length / 4), 0)
  check('respects the token budget', tokens <= 1500, `used ${tokens}`)
  check('respects maxPerDoc', Object.values(
    picked.reduce<Record<string, number>>((acc, c) => {
      acc[c.slug] = (acc[c.slug] ?? 0) + 1; return acc
    }, {})).every((n) => n <= 2))
  check('picks something', picked.length > 0, `${picked.length} chunks, ${tokens} tokens`)
}

console.log('\nfusion and similarity')
{
  const a = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
  const b = [{ id: 'z' }, { id: 'x' }]
  const fused = fuse([a, b], (i) => i.id)
  check('fusion dedupes', fused.length === 3, `${fused.length}`)
  check('item ranked well in both wins', fused[0].id === 'x', fused.map((f) => f.id).join(','))
  check('cosine of identical vectors is 1', Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9)
  check('cosine of orthogonal vectors is 0', Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9)
  check('cosine handles zero vector', cosineSimilarity([0, 0], [1, 1]) === 0)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
