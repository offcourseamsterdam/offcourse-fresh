import Anthropic from '@anthropic-ai/sdk'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/server'

const SYSTEM_PROMPT = `You are writing a reply to a Google review for Off Course Amsterdam — an electric canal boat company in Amsterdam. You are the business owner replying personally.

VOICE:
- Warm, casual, genuine. Like a friend thanking someone, not a PR team.
- Use the reviewer's first name (never "Dear X" or "Hello X")
- Reference something SPECIFIC they mentioned — a detail, a moment, a feeling
- Keep it 2-4 sentences. Short and sweet. Never over 5 sentences.
- Dry humor is welcome when natural, but never forced
- If they mention a crew member (Jannah, Beer), reference them warmly

NEVER use:
- "We appreciate your feedback" or any corporate template language
- "valued customer", "don't hesitate to reach out", "we look forward to"
- "Thank you for taking the time to write"
- "embark on a journey", "exclusive experience", "curated"
- Exclamation marks on every sentence (one is fine, three is not)

STYLE:
- Sign off naturally — no formal signature needed
- Match the energy of the review (enthusiastic review = warm reply, calm review = chill reply)
- If they had a specific experience (sunset cruise, birthday, etc.), acknowledge it
- It's OK to be a little playful or unexpected

EXAMPLES of good tone:
- "Sara! The canals really do hit different with good company. Glad you felt it too — come back anytime, we'll save you the good seat."
- "Shaun, Amsterdam + birthday + Diana = basically a perfect combo. Tell your wife happy birthday from the crew!"
- "Halina, evening cruises with wine and bites — you basically nailed the perfect Off Course night. The canals thank you for the compliment."

You MUST write a unique reply that doesn't repeat phrases from previous replies. Output ONLY the reply text, nothing else.`

export async function POST(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const body = await request.json().catch(() => ({}))
  const { reviewId } = body as { reviewId?: string }

  if (!reviewId) {
    return apiError('Missing reviewId', 400)
  }

  const supabase = createAdminClient()

  // Fetch the review to reply to
  const { data: review, error: reviewError } = await supabase
    .from('social_proof_reviews')
    .select('reviewer_name, review_text, rating, publish_time')
    .eq('id', reviewId)
    .single()

  if (reviewError || !review) {
    return apiError('Review not found', 404)
  }

  // Fetch recent replies to avoid repetition
  const { data: recentReplies } = await supabase
    .from('social_proof_reviews')
    .select('confirmed_reply, ai_draft_reply')
    .not('confirmed_reply', 'is', null)
    .order('reply_posted_at', { ascending: false })
    .limit(5)

  const previousReplies = (recentReplies ?? [])
    .map(r => r.confirmed_reply || r.ai_draft_reply)
    .filter(Boolean)

  // Build the user prompt
  const userPrompt = [
    `Review by ${review.reviewer_name} (${review.rating}/5 stars):`,
    `"${review.review_text}"`,
    '',
    previousReplies.length > 0
      ? `Previous replies (DO NOT repeat these phrases):\n${previousReplies.map((r, i) => `${i + 1}. "${r}"`).join('\n')}`
      : '',
    '',
    'Write a unique reply:',
  ].filter(Boolean).join('\n')

  // Generate with Claude
  const anthropic = new Anthropic()

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const reply = message.content[0].type === 'text'
      ? message.content[0].text.trim()
      : ''

    if (!reply) {
      return apiError('AI returned empty reply', 500)
    }

    // Save draft to DB
    await supabase
      .from('social_proof_reviews')
      .update({ ai_draft_reply: reply })
      .eq('id', reviewId)

    return apiOk({ reply, reviewId })
  } catch (err) {
    console.error('[generate-reply] Claude error:', err)
    return apiError(
      `AI generation failed: ${err instanceof Error ? err.message : 'unknown'}`,
      502,
    )
  }
}
