import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getClaude, CLAUDE_MODEL } from '@/lib/ai/clients'
import { OFF_COURSE_SYSTEM_PROMPT } from '@/lib/ai/context'

/**
 * POST /api/admin/boats/translate
 *
 * Translates a boat description from English into all 6 other locales
 * using Claude Sonnet with the Off Course brand voice.
 *
 * Body: { boatName: string, description: string }
 * Returns: { nl, de, fr, es, pt, zh }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { boatName, description } = await req.json()

    if (!description?.trim()) {
      return apiError('description is required', 400)
    }

    const claude = getClaude()

    const prompt = `Translate this boat description for "${boatName}" into Dutch (nl), German (de), French (fr), Spanish (es), Portuguese (pt), and Simplified Chinese (zh).

Keep the Off Course brand voice — casual, warm, a little dry. Never corporate. Short sentences are fine.

English original:
${description}

Return ONLY a JSON object with keys: nl, de, fr, es, pt, zh. No markdown, no explanation, just the JSON.`

    const message = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: OFF_COURSE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const translations = JSON.parse(cleaned)

    return apiOk({ translations })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Translation failed', 500)
  }
}
