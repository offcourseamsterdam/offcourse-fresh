import type Anthropic from '@anthropic-ai/sdk'
import { getClaude, firstText, CLAUDE_MODEL } from '@/lib/ai/clients'
import { OFF_COURSE_SYSTEM_PROMPT } from '@/lib/ai/context'
import { PLATFORM_LABEL } from './platform-labels'

/**
 * Reply-specific voice rules, carried over near-verbatim from the pre-2026-06
 * Google-only reply generator (deleted in migration 053 along with the OAuth
 * auto-posting it fed) — the tone guidance held up, only the platform
 * framing needed generalizing to all four review sources. Tightened
 * 2026-08-22 (Beer, live on the first real draft): "don't make the AI
 * replies too cheesy, just thankful" — the model's default instinct here is
 * to manufacture a clever line or a little metaphor ("made two hours feel
 * like the afternoon disappeared"), which reads as performative rather than
 * like an actual person saying thanks.
 */
const REPLY_VOICE_RULES = `You are writing a reply to a customer review, as the business owner replying personally.

VOICE:
- Warm, casual, genuine. Like a friend thanking someone, not a PR team.
- Simple and thankful beats clever. Don't manufacture a poetic line, a metaphor, or a "moment" that
  wasn't actually in the review — if the review is plain, the reply can be plain too.
- Use the reviewer's first name (never "Dear X" or "Hello X")
- Reference something SPECIFIC they mentioned — a detail, a moment, a feeling — factually, not
  dressed up
- Keep it 1-3 sentences. Shorter is almost always better here.
- Dry humor is welcome when natural, but never forced — most replies need none at all
- If they mention a crew member (Jannah, Beer), reference them warmly, without inventing a
  personality trait or backstory for them

NEVER use:
- "We appreciate your feedback" or any corporate template language
- "valued customer", "don't hesitate to reach out", "we look forward to"
- "Thank you for taking the time to write"
- "embark on a journey", "exclusive experience", "curated"
- Exclamation marks on every sentence (one is fine, three is not)
- Invented imagery/metaphors the reviewer didn't use themselves (e.g. turning "great trip" into a
  line about time disappearing, light on the water, etc.) — that reads as trying too hard, not warm

STYLE:
- Sign off naturally — no formal signature needed
- Match the energy of the review (enthusiastic review = warm reply, calm review = chill reply)
- If they had a specific experience (sunset cruise, birthday, etc.), acknowledge it

You MUST write a unique reply that doesn't repeat phrases from previous replies. Output ONLY the reply text, nothing else.`

export interface DraftReplyInput {
  platform: string
  reviewerName: string
  reviewText: string
  rating: number
  /** Most recent replies across any review, so Claude doesn't reuse the same phrasing every time. */
  recentReplies?: string[]
}

export interface DraftReplyOptions {
  claude?: Anthropic
}

/**
 * Drafts a reply for a human to copy-paste into the review platform's own
 * dashboard (Beer, 2026-08-22, plan Phase 4) — no platform has this wired to
 * auto-post. Same function for all four sources; platform only changes the
 * one line of framing in the prompt, not the voice rules.
 */
export async function draftReviewReply(input: DraftReplyInput, options: DraftReplyOptions = {}): Promise<string> {
  const claude = options.claude ?? getClaude()
  const platformLabel = PLATFORM_LABEL[input.platform] ?? input.platform

  const userPrompt = [
    `Review on ${platformLabel} by ${input.reviewerName} (${input.rating}/5 stars):`,
    `"${input.reviewText}"`,
    '',
    input.recentReplies?.length
      ? `Previous replies (DO NOT repeat these phrases):\n${input.recentReplies.map((r, i) => `${i + 1}. "${r}"`).join('\n')}`
      : '',
    '',
    'Write a unique reply:',
  ].filter(Boolean).join('\n')

  const message = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system: `${OFF_COURSE_SYSTEM_PROMPT}\n\n${REPLY_VOICE_RULES}`,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const reply = firstText(message)
  if (!reply) throw new Error('Claude returned an empty reply')
  return reply
}
