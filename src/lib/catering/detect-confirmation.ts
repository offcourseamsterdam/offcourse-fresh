/**
 * Classifies a supplier's reply to a catering order-request email.
 *
 * Deliberately NOT a Ghost "kind" (no agent_proposals row, no autonomy-ladder
 * registration in src/lib/ghost/agents.ts, no tool-use loop). The "which
 * booking is this about" question is already answered deterministically
 * before this runs — src/lib/gmail/sync.ts matches the reply's Gmail
 * threadId against bookings.catering_thread_id. What's left is a single,
 * narrow classification call, not open-ended reasoning, so the heavier
 * proposal/review machinery built for booking-affecting decisions would be
 * pure overhead here. See docs/features/gmail-inbox-integration.md for the
 * full reasoning.
 */

import { CLAUDE_DRAFTER_MODEL } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'

export type CateringConfirmationResult = 'confirmed' | 'needs_reply' | 'unclear'

const CLASSIFY_TOOL = {
  name: 'classify_catering_reply',
  description: 'Classify a supplier email replying to a catering order request.',
  input_schema: {
    type: 'object' as const,
    properties: {
      classification: {
        type: 'string',
        enum: ['confirmed', 'needs_reply', 'unclear'],
        description:
          "'confirmed' = the supplier accepts/confirms the order as-is. " +
          "'needs_reply' = the supplier asks a question or raises an issue that needs a human reply. " +
          "'unclear' = ambiguous, unrelated, or automated content (e.g. an out-of-office auto-reply) that isn't a real answer either way.",
      },
    },
    required: ['classification'],
  },
}

/**
 * Fails closed: any error, missing tool call, or unrecognized value returns
 * 'unclear' — never 'confirmed'. A classification failure must never
 * silently mark a catering order as confirmed when it wasn't.
 */
export async function detectCateringConfirmation(emailBody: string): Promise<CateringConfirmationResult> {
  try {
    const response = await meteredMessage('catering_confirmation_detect', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 200,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
      messages: [
        {
          role: 'user',
          content: `A catering supplier ("Pure Boats") was emailed an order request for an upcoming boat cruise. Here is their reply. Classify it using the classify_catering_reply tool.

SUPPLIER REPLY:
${emailBody}`,
        },
      ],
    })

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
    )
    if (!toolUse) return 'unclear'

    const input = toolUse.input as { classification?: unknown }
    const classification = input.classification
    if (classification === 'confirmed' || classification === 'needs_reply' || classification === 'unclear') {
      return classification
    }
    return 'unclear'
  } catch (err) {
    console.error('[catering/detect-confirmation] classification failed:', err instanceof Error ? err.message : err)
    return 'unclear'
  }
}
