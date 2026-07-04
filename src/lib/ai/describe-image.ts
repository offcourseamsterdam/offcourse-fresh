import { GEMINI_MODEL, getGemini } from './clients'
import { recordAiUsage } from './usage'

/**
 * Generic, METERED image description with Gemini.
 *
 * Unlike describeWithGemini() in generate-image-metadata.ts (SEO-shaped and
 * currently unmetered), this takes any instruction, returns plain text, and
 * always records token usage via recordAiUsage() — an unmetered AI call is
 * invisible spend (CLAUDE.md). Used by the maintenance agent to turn a
 * reported photo into words for the technician email.
 *
 * Best-effort: retries a transient 503, otherwise throws — callers (shadow
 * drafters) swallow.
 */
export async function describeImageWithGemini(
  base64: string,
  mimeType: string,
  prompt: string,
  opts: { feature?: string; maxRetries?: number } = {},
): Promise<string> {
  const feature = opts.feature ?? 'gemini_describe_image'
  const model = getGemini().getGenerativeModel({ model: GEMINI_MODEL })

  let retries = opts.maxRetries ?? 2
  let result: Awaited<ReturnType<typeof model.generateContent>>
  for (;;) {
    try {
      result = await model.generateContent([
        { text: prompt },
        { inlineData: { data: base64, mimeType } },
      ])
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (retries > 0 && msg.includes('503')) {
        retries--
        await new Promise(r => setTimeout(r, 4000))
        continue
      }
      throw err
    }
  }

  const usage = result.response.usageMetadata
  await recordAiUsage({
    feature,
    model: GEMINI_MODEL,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  })

  return result.response.text().trim()
}

/**
 * Fetch an image URL into base64 + mime type. `headers` lets callers pass
 * auth (e.g. a Slack bot token for private file URLs).
 */
export async function fetchImageAsBase64(
  url: string,
  headers?: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetchImpl(url, headers ? { headers } : undefined)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`)
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  return { base64: buf.toString('base64'), mimeType }
}
