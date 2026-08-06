/**
 * Turns a raw inbound email into a one-line summary for the inbox list —
 * cheapest model (Haiku), one job: what is this about, and what's the
 * proposed next action for whoever reads it. Real emails (especially OTA
 * notifications) are full of marketing boilerplate, tracking links, and
 * unsubscribe footers that make the raw-body snippet useless at a glance.
 *
 * `context` folds in whatever Ghost's own pipeline already found or did for
 * this message (an availability check, a drafted reply, a catering
 * classification) so the summary reflects the full picture, not just the
 * inbound text — see gmail/sync.ts.
 */
import { CLAUDE_DRAFTER_MODEL } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'

const SUMMARY_TOOL = {
  name: 'submit_summary',
  description: 'Submit a one-line summary of this email for a busy inbox list.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description:
          'One short sentence, under 120 characters, plain English. Lead straight with concrete facts: date, time, guest count, and any deadline/urgency (e.g. "Sept 24, 10:30am, 2 guests — confirm within 48h, ref 39f8dc7a"). Do NOT open with or restate framing words like "New booking request", "Booking confirmed", "canal cruise", or "boat tour" — the inbox already shows what kind of request this is and what activity it is for as a separate label above this summary, so repeating any of that is redundant filler. Never state whether it is available/bookable in prose either — that is shown separately as a checkmark icon driven by the actual tool result, not by you. Skip greetings, marketing fluff, tracking links, and unsubscribe footers — get straight to the point.',
      },
    },
    required: ['summary'],
  },
}

export async function summarizeInboundEmail(params: {
  subject: string
  bodyText: string
  /** What Ghost's own pipeline already found/did for this message, if anything. */
  context?: string | null
}): Promise<string | null> {
  try {
    const response = await meteredMessage('inbox_email_summary', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 200,
      tools: [SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Summarize this inbound email for a busy inbox list.

SUBJECT: ${params.subject}

BODY:
${params.bodyText}
${params.context ? `\n\nWHAT OUR OWN SYSTEM ALREADY FOUND/DID ABOUT THIS (fold into the summary if relevant):\n${params.context}` : ''}`,
        },
      ],
    })

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
    )
    if (!toolUse) return null
    const input = toolUse.input as { summary?: unknown }
    return typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : null
  } catch (err) {
    console.error('[gmail/summarize] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
