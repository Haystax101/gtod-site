/**
 * Embedding provider, kept behind one function so the vendor is a config
 * change rather than a code change.
 *
 * The request shape is the OpenAI-compatible `/embeddings` contract, which
 * OpenRouter, OpenAI and most gateways accept. If a provider needs a different
 * shape (Google's native generativelanguage API does), add a branch here -
 * nothing else in the codebase talks to an embedding API.
 *
 * Retrieval degrades gracefully: with no key set, `embed` returns null and
 * search falls back to lexical ranking only.
 */
import { EMBEDDING_DIMENSIONS } from './schema'

export interface EmbeddingConfig {
  url: string
  model: string
  apiKey: string
  dimensions: number
}

/** Null when no embedding provider is configured, which is a supported state. */
export function embeddingConfig(): EmbeddingConfig | null {
  const apiKey = process.env.EMBEDDINGS_API_KEY ?? process.env.OPENROUTER_API_KEY
  const model = process.env.EMBEDDINGS_MODEL
  if (!apiKey || !model) return null
  return {
    url: process.env.EMBEDDINGS_URL ?? 'https://openrouter.ai/api/v1/embeddings',
    model,
    apiKey,
    dimensions: Number(process.env.EMBEDDINGS_DIMENSIONS ?? EMBEDDING_DIMENSIONS),
  }
}

/** Providers reject very large batches; this is well inside every limit. */
const BATCH_SIZE = 64

/**
 * Embed texts in order. Returns null when no provider is configured so callers
 * can fall back rather than fail. Throws on a configured provider erroring,
 * because that is a real fault worth surfacing.
 */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const config = embeddingConfig()
  if (!config || !texts.length) return null

  const vectors: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const res = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: batch,
        // Honoured by providers supporting Matryoshka truncation; ignored by
        // those whose width is fixed. Either way the assertion below is what
        // guarantees the vectors match the schema.
        dimensions: config.dimensions,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Embedding provider returned ${res.status}: ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] }
    if (!json.data?.length) throw new Error('Embedding provider returned no data')

    // Providers do not guarantee response order; sort by the echoed index.
    const ordered = [...json.data].sort((a, b) => a.index - b.index)
    for (const item of ordered) {
      if (item.embedding.length !== config.dimensions) {
        throw new Error(
          `Embedding width ${item.embedding.length} does not match the ${config.dimensions} ` +
            'the schema declares. Set EMBEDDINGS_DIMENSIONS and EMBEDDING_DIMENSIONS to match, ' +
            'then re-embed every chunk.',
        )
      }
      vectors.push(item.embedding)
    }
  }
  return vectors
}
