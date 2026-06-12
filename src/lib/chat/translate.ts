import { getClaude, CLAUDE_MODEL } from '@/lib/ai/clients'
import { recordAiUsage } from '@/lib/ai/usage'

/**
 * Detect the language of a message and translate it to English.
 * Returns null if the message is already English or detection fails.
 */
export async function translateToEnglish(text: string): Promise<{ translation: string; detected_language: string } | null> {
  const claude = getClaude()

  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Detect the language of this message and translate it to English.

If the message is already in English, respond with exactly: ENGLISH

Otherwise respond with this format (two lines, nothing else):
LANGUAGE: <language name in English>
TRANSLATION: <the English translation>

Message to translate:
"""
${text}
"""`,
      },
    ],
  })

  await recordAiUsage({
    feature: 'chat_translate',
    model: CLAUDE_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })

  const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  if (!raw || raw === 'ENGLISH') return null

  const langMatch = raw.match(/^LANGUAGE:\s*(.+)/m)
  const transMatch = raw.match(/^TRANSLATION:\s*([\s\S]+)/m)

  if (!langMatch || !transMatch) return null

  return {
    detected_language: langMatch[1].trim(),
    translation: transMatch[1].trim(),
  }
}

/**
 * Translate admin reply to a customer's language (for outbound auto-translation).
 * Uses the Off Course brand voice.
 */
export async function translateReply(text: string, targetLocale: string): Promise<string> {
  const LOCALE_NAMES: Record<string, string> = {
    nl: 'Dutch',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    pt: 'Portuguese',
    zh: 'Chinese (Simplified)',
  }

  const targetLanguage = LOCALE_NAMES[targetLocale]
  if (!targetLanguage) return text

  const claude = getClaude()

  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `You are translating a customer service reply for Off Course Amsterdam, a friendly boat tour company. Translate the following reply into ${targetLanguage}. Keep the warm, casual, friendly tone — this is "your friend with a boat", not a formal tour company. Translate only; no explanation.

Text to translate:
"""
${text}
"""`,
      },
    ],
  })

  await recordAiUsage({
    feature: 'chat_translate',
    model: CLAUDE_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : text
}
