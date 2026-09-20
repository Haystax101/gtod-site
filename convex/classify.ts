/**
 * The evidence classifier: transcribe the recording, then ask a cheap text
 * model whether the agent said the line and whether anyone answered.
 *
 * Two calls, both priced in fractions of a penny:
 *   1. Groq Whisper (whisper-large-v3-turbo) for the transcript.
 *   2. DeepSeek for the judgement, as strict JSON.
 *
 * Thresholds below decide what happens without a human. Everything that is
 * not a confident yes or a confident no goes to HQ as `pending`, and so does
 * anything that errors, so a provider outage can never lose a submission.
 */
import { internalAction } from './_generated/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'

const APPROVE_AT = 0.8
const REJECT_AT = 0.85
const MIN_TRANSCRIPT_CHARS = 8

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = process.env.GROQ_TRANSCRIBE_MODEL ?? 'whisper-large-v3-turbo'
// Fallback transcriber when there is no Groq key: Gemini reads the audio directly.
const GEMINI_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-flash-lite-latest'

/**
 * The judge is DeepSeek, reached directly (DEEPSEEK_API_KEY) or through
 * OpenRouter (OPENROUTER_API_KEY) when that is the key to hand. Both speak the
 * OpenAI chat format, so only the URL, key and model slug differ.
 */
function judgeConfig() {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      url: (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com') + '/chat/completions',
      key: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    }
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: process.env.OPENROUTER_API_KEY,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek/deepseek-chat',
    }
  }
  // Last resort: Gemini speaks the same chat format on its OpenAI-compatible endpoint.
  if (process.env.GEMINI_API_KEY) {
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_JUDGE_MODEL ?? 'gemini-flash-lite-latest',
    }
  }
  return null
}

export function classifierConfigured() {
  return Boolean((process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY) && judgeConfig())
}

interface Verdict {
  saidPhrase: boolean
  gotResponse: boolean
  encounterCount: number
  confidence: number
  reasoning: string
  model: string
}

export const run = internalAction({
  args: { submissionId: v.id('submissions') },
  handler: async (ctx, { submissionId }) => {
    const row = await ctx.runQuery(internal.missions.getForClassifier, { submissionId })
    if (!row || !row.submission.storageId || row.submission.status !== 'processing') return
    const { submission, phrase, title } = row
    const storageId = submission.storageId
    if (!storageId) return
    let transcript: string | undefined

    try {
      const blob = await ctx.storage.get(storageId)
      if (!blob) throw new Error('Evidence missing from storage')

      const text = await transcribe(blob, submission.mimeType ?? blob.type, phrase)
      transcript = text
      if (text.trim().length < MIN_TRANSCRIPT_CHARS) {
        await ctx.runMutation(internal.missions.recordVerdict, {
          submissionId,
          transcript,
          decision: 'rejected',
          verifiedCount: 0,
          verdict: {
            saidPhrase: false,
            gotResponse: false,
            encounterCount: 0,
            confidence: 1,
            reasoning: 'The recording contained no usable speech.',
            model: GROQ_MODEL,
          },
        })
        return
      }

      const verdict = await judge(text, phrase, title, submission.claimedCount)
      const heard = Math.max(0, Math.round(verdict.encounterCount))
      const success = verdict.saidPhrase && verdict.gotResponse && heard > 0

      let decision: 'approved' | 'rejected' | 'pending' = 'pending'
      if (success && verdict.confidence >= APPROVE_AT) decision = 'approved'
      else if (!verdict.saidPhrase && verdict.confidence >= REJECT_AT) decision = 'rejected'

      await ctx.runMutation(internal.missions.recordVerdict, {
        submissionId,
        transcript,
        verdict,
        decision,
        // Never award more than they claimed, and never more than was heard.
        verifiedCount: decision === 'approved' ? Math.min(heard, submission.claimedCount) : 0,
      })
    } catch (err: any) {
      console.error('classify failed', submissionId, err?.message)
      await ctx.runMutation(internal.missions.recordVerdict, {
        submissionId,
        transcript,
        decision: 'pending',
        error: String(err?.message ?? err).slice(0, 300),
      })
    }
  },
})

async function transcribe(blob: Blob, mimeType: string, phrase: string) {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    if (process.env.GEMINI_API_KEY) return transcribeWithGemini(blob, mimeType, phrase)
    throw new Error('No transcription key set (GROQ_API_KEY or GEMINI_API_KEY)')
  }
  const ext = extFor(mimeType)
  const form = new FormData()
  form.append('file', new File([blob], `evidence.${ext}`, { type: mimeType }))
  form.append('model', GROQ_MODEL)
  form.append('language', 'en')
  form.append('temperature', '0')
  // A prompt biases Whisper's spelling toward the phrase we are listening for.
  form.append('prompt', `A student in freshers' week asks strangers: "${phrase}"`)
  form.append('response_format', 'json')
  const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form })
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}

async function transcribeWithGemini(blob: Blob, mimeType: string, phrase: string) {
  const key = process.env.GEMINI_API_KEY!
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `Transcribe this recording verbatim in English. Label speakers as "Agent:" (the person asking questions, who may say "${phrase}") and "Other:" for anyone else. Output only the transcript, no commentary. If there is no speech, output nothing.` },
          { inlineData: { mimeType: mimeType.split(';')[0] || 'audio/webm', data: btoa(bin) } },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  })
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as any
  return (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
}

async function judge(transcript: string, phrase: string, title: string, claimed: number): Promise<Verdict> {
  const cfg = judgeConfig()
  if (!cfg) throw new Error('No judge key set (DEEPSEEK_API_KEY or OPENROUTER_API_KEY)')

  const system = `You verify audio evidence for a light-hearted university freshers' challenge.
The challenge ("${title}") requires the agent to say the line "${phrase}" (or a very close paraphrase, e.g. "are you here for uni?", "you here for uni, yeah?") to a stranger, and the stranger to respond in some way (anything counts: "yeah", "no", a laugh, a question back).

You are given an automatic transcript. Transcripts are imperfect: expect misheard words, missing punctuation and no speaker labels. Infer speakers from content.

Count each distinct occasion the line was said AND answered as one encounter. If the same person is asked twice, that is one encounter.

Respond with strict JSON only:
{"saidPhrase": boolean, "gotResponse": boolean, "encounterCount": integer, "confidence": number 0-1, "reasoning": string (one sentence, addressed to the agent)}

confidence is how sure you are of the overall verdict. Be generous with paraphrase, strict about there actually being an exchange: an agent narrating "I asked five people" without any exchanges audible is saidPhrase=false.`

  const user = `The agent claims ${claimed} encounter(s).\n\nTRANSCRIPT:\n"""\n${transcript.slice(0, 12_000)}\n"""`

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Classifier failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = data.choices?.[0]?.message?.content ?? ''
  let parsed: any
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    throw new Error(`Classifier returned non-JSON: ${raw.slice(0, 120)}`)
  }
  return {
    saidPhrase: Boolean(parsed.saidPhrase),
    gotResponse: Boolean(parsed.gotResponse),
    encounterCount: Number.isFinite(Number(parsed.encounterCount)) ? Number(parsed.encounterCount) : 0,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reasoning: String(parsed.reasoning ?? '').slice(0, 300),
    model: cfg.model,
  }
}

function extFor(mime: string) {
  const m = mime.toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('flac')) return 'flac'
  return 'webm'
}
