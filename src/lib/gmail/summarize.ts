/**
 * Turns a raw inbound email into a one-line summary for the inbox list —
 * cheapest model (Haiku), one job: what is this about, and what's the
 * proposed next action for whoever reads it. Real emails (especially OTA
 * notifications) are full of marketing boilerplate, tracking links, and
 * unsubscribe footers that make the raw-body snippet useless at a glance.
 *
 * The same call also answers "does someone at Off Course need to write back?"
 * — layer 2 of the reply doorman (reply-triage.ts). Riding along on a call we
 * already pay for keeps that second opinion free; a separate classifier call
 * would cost as much again for one extra word of output.
 *
 * `context` folds in whatever Ghost's own pipeline already found or did for
 * this message (an availability check, a drafted reply, a catering
 * classification) so the summary reflects the full picture, not just the
 * inbound text — see gmail/sync.ts.
 */
import { CLAUDE_DRAFTER_MODEL } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { parseReplyVerdict, type ReplyVerdict } from './reply-triage'

const SUMMARY_TOOL = {
  name: 'submit_summary',
  description: 'Submit a one-line summary of this email for a busy inbox list, plus whether it needs a reply.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description:
          'One short sentence, under 120 characters, plain English. Lead straight with concrete facts: date, time, guest count, and any deadline/urgency (e.g. "Sept 24, 10:30am, 2 guests — confirm within 48h, ref 39f8dc7a"). Do NOT open with or restate framing words like "New booking request", "Booking confirmed", "canal cruise", or "boat tour" — the inbox already shows what kind of request this is and what activity it is for as a separate label above this summary, so repeating any of that is redundant filler. Never state whether it is available/bookable in prose either — that is shown separately as a checkmark icon driven by the actual tool result, not by you. Skip greetings, marketing fluff, tracking links, and unsubscribe footers — get straight to the point.',
      },
      needs_reply: {
        type: 'string',
        enum: ['yes', 'no', 'maybe'],
        description:
          'Does a person at Off Course Amsterdam (a small canal-boat company) need to WRITE BACK to this email? "yes" = a real person asks a question, makes a request or complaint, or is clearly waiting for an answer. "no" = automated notification, receipt, invoice notice, newsletter, marketing, account/security alert, or a message that needs nothing back (a plain "thanks", "see you Saturday", a confirmation of something already settled). "maybe" = genuinely unsure. When torn between yes and no, answer "maybe" — a human will check.',
      },
      needs_reply_reason: {
        type: 'string',
        description: 'At most 8 words, plain English, why — e.g. "Guest asks about bringing a dog" or "Automated receipt from Stripe".',
      },
    },
    required: ['summary', 'needs_reply'],
  },
}

export interface InboundEmailSummary {
  /** Null when the model returned no usable summary — the inbox then falls back to the raw snippet. */
  summary: string | null
  /** Null when the model didn't give one of the three verdicts — reply-triage.ts then leans on rules alone. */
  needsReply: ReplyVerdict | null
  needsReplyReason: string | null
}

export async function summarizeInboundEmail(params: {
  subject: string
  bodyText: string
  /** Sender address — "noreply@…" vs "jane@gmail.com" is itself a strong hint for needs_reply. */
  fromEmail?: string | null
  /** What Ghost's own pipeline already found/did for this message, if anything. */
  context?: string | null
}): Promise<InboundEmailSummary | null> {
  try {
    const response = await meteredMessage('inbox_email_summary', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 300,
      tools: [SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Summarize this inbound email for a busy inbox list, and say whether it needs a reply.
${params.fromEmail ? `\nFROM: ${params.fromEmail}` : ''}
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
    const input = toolUse.input as { summary?: unknown; needs_reply?: unknown; needs_reply_reason?: unknown }
    const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : null
    const needsReply = parseReplyVerdict(input.needs_reply)
    const reason = typeof input.needs_reply_reason === 'string' && input.needs_reply_reason.trim() ? input.needs_reply_reason.trim().slice(0, 120) : null
    if (!summary && !needsReply) return null
    return { summary, needsReply, needsReplyReason: needsReply ? reason : null }
  } catch (err) {
    console.error('[gmail/summarize] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
