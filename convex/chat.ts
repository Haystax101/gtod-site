import { internalAction, internalQuery, mutation } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './users'
import { TIERS, estimateTokens, monthKey, startOfDay } from './tiers'
import { buildSystemPrompt, buildUserTurn } from './prompt'
import { bm25, fuse, selectChunks } from './retrieval'
import { embed, embeddingConfig } from './embeddings'

const MAX_MESSAGE_CHARS = 6000

// User sends a message: enforce limits, store it, create the assistant placeholder,
// and kick off generation. The client sees the reply stream in via the messages query.
export const send = mutation({
  args: {
    conversationId: v.optional(v.id('conversations')),
    content: v.string(),
    attachmentIds: v.optional(v.array(v.id('attachments'))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const content = args.content.trim().slice(0, MAX_MESSAGE_CHARS)
    const attachmentIds = args.attachmentIds ?? []
    if (!content && !attachmentIds.length) throw new ConvexError('Say something first')
    const tier = TIERS[user.plan]

    // Daily message cap
    const today = await ctx.db
      .query('messages')
      .withIndex('by_user', (q) => q.eq('userId', user._id).gte('createdAt', startOfDay()))
      .filter((q) => q.eq(q.field('role'), 'user'))
      .collect()
    if (today.length >= tier.dailyMessages) {
      throw new ConvexError(
        user.plan === 'pro'
          ? `You've hit today's limit of ${tier.dailyMessages} messages. It resets at midnight UTC.`
          : `LIMIT:You've used today's ${tier.dailyMessages} free messages. Upgrade to Pro for more, or come back tomorrow.`,
      )
    }
    // Monthly cost cap
    const usage = await ctx.db
      .query('usage')
      .withIndex('by_user_month', (q) => q.eq('userId', user._id).eq('month', monthKey()))
      .unique()
    if ((usage?.costMicros ?? 0) >= tier.monthlyCostMicros) {
      throw new ConvexError(
        user.plan === 'pro'
          ? "You've used this month's Pro allowance. It resets on the 1st."
          : "LIMIT:You've used this month's free allowance. Upgrade to Pro to keep going.",
      )
    }

    // Attachments must belong to this user
    for (const id of attachmentIds) {
      const a = await ctx.db.get(id)
      if (!a || a.userId !== user._id) throw new ConvexError('Attachment not found')
    }

    const now = Date.now()
    let conversationId: Id<'conversations'>
    if (args.conversationId) {
      conversationId = args.conversationId
      const convo = await ctx.db.get(conversationId)
      if (!convo || convo.userId !== user._id) throw new ConvexError('Conversation not found')
      const last = await ctx.db
        .query('messages')
        .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
        .order('desc')
        .first()
      if (last?.status === 'streaming') throw new ConvexError('Wait for the current reply to finish')
      await ctx.db.patch(conversationId, { updatedAt: now })
    } else {
      const title = (content || 'Document review').replace(/\s+/g, ' ').slice(0, 60)
      conversationId = await ctx.db.insert('conversations', { userId: user._id, title, createdAt: now, updatedAt: now })
    }

    await ctx.db.insert('messages', {
      conversationId,
      userId: user._id,
      role: 'user',
      content,
      status: 'done',
      attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      createdAt: now,
    })
    const assistantId = await ctx.db.insert('messages', {
      conversationId,
      userId: user._id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      tier: user.plan,
      model: tier.model,
      createdAt: now + 1,
    })
    await ctx.scheduler.runAfter(0, internal.chat.generate, { assistantId })
    return { conversationId, assistantId }
  },
})

// Everything the model call needs, gathered in one transaction.
export const context = internalQuery({
  args: { assistantId: v.id('messages') },
  handler: async (ctx, { assistantId }) => {
    const assistant = await ctx.db.get(assistantId)
    if (!assistant) throw new ConvexError('Message vanished')
    const tierKey = assistant.tier ?? 'flash'
    const tier = TIERS[tierKey]
    const history = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', assistant.conversationId))
      .order('desc')
      .take(tier.contextMessages + 1)
    const turns = history.filter((m) => m._id !== assistantId && m.status !== 'error').reverse()

    // Attachments referenced anywhere in the (windowed) conversation
    const ids = new Map<string, Id<'attachments'>>()
    for (const m of turns) for (const id of m.attachmentIds ?? []) ids.set(id, id)
    const attachments: Doc<'attachments'>[] = []
    for (const id of ids.values()) {
      const a = await ctx.db.get(id)
      if (a) attachments.push(a)
    }
    const nameOf = (id: Id<'attachments'>) => attachments.find((a) => a._id === id)?.name ?? 'document'
    // Only always-on docs (the playbook) go into the cached system prompt.
    // Everything else is retrieved per question in the generate action.
    const docs = (await ctx.db.query('knowledge').collect()).filter((d) => d.enabled && d.alwaysOn)
    return {
      tierKey,
      system: buildSystemPrompt(docs, attachments),
      turns: turns.map((m) => ({
        role: m.role,
        content:
          m.role === 'user' && m.attachmentIds?.length
            ? `${m.content}\n\n[Attached: ${m.attachmentIds.map(nameOf).join(', ')}]`
            : m.content,
      })),
    }
  },
})

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Tokens of retrieved knowledge allowed into a single message. */
const RETRIEVAL_TOKEN_BUDGET = 2500
/** Candidates pulled from each retrieval strategy before fusion. */
const CANDIDATES = 12

/**
 * Find the knowledge chunks worth putting in front of the model for this
 * question. Lexical BM25 always runs; vector search joins in when an embedding
 * provider is configured, and the two rankings are combined with reciprocal
 * rank fusion. With no embeddings configured this degrades to lexical-only
 * rather than failing.
 */
export async function retrieve(ctx: any, question: string) {
  if (!question.trim()) return []

  const chunks = await ctx.runQuery(internal.knowledge.allChunks, {})
  if (!chunks.length) return []

  const lexical = bm25(question, chunks)
    .slice(0, CANDIDATES)
    .map((r: { chunk: any }) => r.chunk)

  const rankings = [lexical]

  if (embeddingConfig()) {
    try {
      const [vector] = (await embed([question])) ?? []
      if (vector) {
        const hits = await ctx.vectorSearch('knowledgeChunks', 'by_embedding', {
          vector,
          limit: CANDIDATES,
        })
        const semantic = await ctx.runQuery(internal.knowledge.chunksByIds, {
          ids: hits.map((h: { _id: string }) => h._id),
        })
        if (semantic.length) rankings.push(semantic)
      }
    } catch (err) {
      // Retrieval must never take the whole reply down with it.
      console.error('vector retrieval failed, continuing lexically', err)
    }
  }

  const fused = fuse(rankings, (c: any) => String(c._id))
  return selectChunks(fused, { tokenBudget: RETRIEVAL_TOKEN_BUDGET })
}

export const generate = internalAction({
  args: { assistantId: v.id('messages') },
  handler: async (ctx, { assistantId }) => {
    const { tierKey, system, turns } = await ctx.runQuery(internal.chat.context, { assistantId })
    const tier = TIERS[tierKey]
    const key = process.env.OPENROUTER_API_KEY
    if (!key) {
      await ctx.runMutation(internal.messages.fail, {
        id: assistantId,
        error: "Charge isn't configured yet (OPENROUTER_API_KEY missing).",
      })
      return
    }

    // Retrieve against the newest user message and attach the extracts to it.
    // They ride on the user turn rather than the system prompt so the cached
    // prefix survives between messages.
    const lastUser = [...turns].reverse().find((t) => t.role === 'user')
    const extracts = await retrieve(ctx, lastUser?.content ?? '')
    const messages = turns.map((t) =>
      t === lastUser ? { ...t, content: buildUserTurn(t.content, extracts) } : t,
    )

    let content = ''
    let inputTokens = 0
    let outputTokens = 0
    let lastFlush = 0
    const flush = async () => {
      const now = Date.now()
      if (now - lastFlush < 250) return
      lastFlush = now
      await ctx.runMutation(internal.messages.append, { id: assistantId, content })
    }

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          // OpenRouter attributes traffic with these; both are optional.
          'HTTP-Referer': process.env.SITE_URL ?? 'https://getthereoneday.com',
          'X-Title': 'Charge by Get There One Day',
        },
        body: JSON.stringify({
          model: tier.model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: tier.maxOutputTokens,
          // These are short, well-scoped advice answers, and the knowledge is
          // handed over in the prompt, so private reasoning buys little. Left
          // on, it ate most of the token budget and replies stopped mid-word.
          // Providers that don't support the flag ignore it.
          reasoning: { enabled: false },
          temperature: 0.6,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new ConvexError(`OpenRouter returned ${res.status}: ${text.slice(0, 300)}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          let json: any
          try {
            json = JSON.parse(data)
          } catch {
            continue
          }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            content += delta
            await flush()
          }
          if (json.usage) {
            inputTokens = json.usage.prompt_tokens ?? inputTokens
            outputTokens = json.usage.completion_tokens ?? outputTokens
          }
        }
      }
      if (!inputTokens) inputTokens = estimateTokens(system + messages.map((t) => t.content).join(''))
      if (!outputTokens) outputTokens = estimateTokens(content)
      await ctx.runMutation(internal.messages.finish, {
        id: assistantId,
        content: content || "Sorry, I didn't manage to come up with a reply. Try asking again.",
        inputTokens,
        outputTokens,
      })
    } catch (err: any) {
      console.error('generate failed', err)
      await ctx.runMutation(internal.messages.fail, {
        id: assistantId,
        error: 'Something went wrong talking to the model. Please try again in a moment.',
      })
    }
  },
})
