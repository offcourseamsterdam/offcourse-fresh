import { CLAUDE_MODEL } from '@/lib/ai/clients'
import { OFF_COURSE_SYSTEM_PROMPT } from '@/lib/ai/context'
import { runAgenticLoop } from '@/lib/ghost/agent-runtime'
import { buildGhostTools } from '@/lib/ghost/tools'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The inbox agent (and its sidekick, the booking agent) — shadow mode.
 *
 * Fires after every inbound customer message. Unlike the v1 drafter (one
 * Claude call with pre-stuffed context), this is a real agentic loop: the
 * agent can CHECK LIVE FAREHARBOR AVAILABILITY and look up the customer's
 * bookings before deciding what it would reply. If the customer asks to
 * book a concrete slot, it ends with a booking proposal (the action chain
 * a human would click) instead of a plain reply draft.
 *
 * Still shadow: nothing is sent, nothing is booked. Every tool call it
 * makes is recorded in payload.steps — the visible chain of actions.
 * Hard rule: this must NEVER break the customer flow; all errors are
 * swallowed and logged.
 */

const SUBMIT_REPLY = {
  name: 'submit_reply_draft',
  description:
    'Finish by submitting the reply you would send to the customer. Use this for everything that is NOT a concrete booking request.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: "The reply, in the customer's language. Chat-length: 1-3 short sentences usually." },
      language: { type: 'string', description: 'Language of the reply, in English (e.g. German)' },
      reasoning: { type: 'string', description: '1-2 sentences in English: why this reply' },
      open_question: {
        type: ['string', 'null'],
        description: 'ONE precise question for the team if you lacked a fact (policy, amenity, price). null if fully covered.',
      },
    },
    required: ['reply', 'language', 'reasoning'],
  },
}

const SUBMIT_BOOKING = {
  name: 'submit_booking_proposal',
  description:
    'Finish with a booking proposal when the customer clearly wants to book/rebook a SPECIFIC slot AND you have confirmed it is available via search_availability. Includes the reply you would send plus the booking action for the team to approve.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: "The reply you would send, in the customer's language (confirming the option, next step)." },
      language: { type: 'string', description: 'Language of the reply, in English' },
      reasoning: { type: 'string', description: '1-2 sentences in English: why this slot/listing' },
      booking: {
        type: 'object',
        description: 'The booking action the team would approve — only values confirmed by search_availability.',
        properties: {
          listing_slug: { type: 'string' },
          listing_title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'Departure time as shown by search_availability, e.g. 5pm' },
          guests: { type: 'number' },
          option: { type: 'string', description: 'Chosen boat/duration option name if relevant (e.g. Diana 2h)' },
          price_eur: { type: 'number', description: 'Price in euros from search_availability, if shown' },
        },
        required: ['listing_slug', 'listing_title', 'date', 'time', 'guests'],
      },
      open_question: { type: ['string', 'null'], description: 'ONE question for the team if something blocks the booking. null otherwise.' },
    },
    required: ['reply', 'language', 'reasoning', 'booking'],
  },
}

export interface ReplySubmission {
  reply: string
  language: string
  reasoning: string
  open_question: string | null
  booking?: Record<string, unknown>
}

/** Validate + normalize a submit-tool input (schemas constrain shape, not sanity). */
export function validateSubmission(input: Record<string, unknown>): ReplySubmission | null {
  const reply = typeof input.reply === 'string' ? input.reply.trim() : ''
  if (!reply) return null
  return {
    reply,
    language: typeof input.language === 'string' && input.language.trim() ? input.language.trim() : 'unknown',
    reasoning: typeof input.reasoning === 'string' ? input.reasoning.trim() : '',
    open_question:
      typeof input.open_question === 'string' && input.open_question.trim() ? input.open_question.trim() : null,
    booking:
      input.booking && typeof input.booking === 'object' ? (input.booking as Record<string, unknown>) : undefined,
  }
}

export async function draftShadowReply(conversationId: string, triggerMessageId: string | null): Promise<void> {
  try {
    const supabase = createAdminClient()

    // ── Read the truth ──────────────────────────────────────────────────
    const { data: convo } = await supabase
      .from('conversations')
      .select('id, channel, subject, status, contact:contacts(id, name, email, phone_e164, locale, notes)')
      .eq('id', conversationId)
      .single()
    if (!convo?.contact) return

    const { data: messages } = await supabase
      .from('messages')
      .select('direction, body, author_name, created_at')
      .eq('conversation_id', conversationId)
      .in('direction', ['in', 'out'])
      .order('created_at', { ascending: true })
      .limit(30)
    if (!messages?.length || messages[messages.length - 1].direction !== 'in') return

    const contact = convo.contact

    // ── The learning inputs ──────────────────────────────────────────────
    const { data: knowledge } = await supabase
      .from('ghost_knowledge')
      .select('question, answer')
      .order('created_at', { ascending: false })
      .limit(20)
    const knowledgeBlock = knowledge?.length
      ? `THINGS THE TEAM HAS TAUGHT YOU (treat as ground truth)\n${knowledge
          .map(k => `- Q: ${k.question}\n  A: ${k.answer}`)
          .join('\n')}\n\n`
      : ''

    const { data: corrections } = await supabase
      .from('agent_proposals')
      .select('payload, outcome, trigger:messages!agent_proposals_trigger_message_id_fkey(body)')
      .in('kind', ['reply_draft', 'booking_proposal'])
      .not('outcome', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5)
    const correctionLines = (corrections ?? [])
      .map(c => {
        const triggerBody = (c.trigger as { body?: string } | null)?.body
        const draft = (c.payload as { reply?: string })?.reply
        const actual = (c.outcome as { human_reply?: string })?.human_reply
        if (!triggerBody || !draft || !actual) return null
        return `Customer: ${triggerBody}\nYour draft: ${draft}\nHuman actually sent: ${actual}`
      })
      .filter(Boolean)
    const correctionsBlock = correctionLines.length
      ? `HOW THE TEAM ACTUALLY REPLIES (your past drafts vs their real replies — imitate their style and choices)\n${correctionLines.join('\n---\n')}\n\n`
      : ''

    const transcript = messages
      .map(m => `${m.direction === 'in' ? `CUSTOMER (${m.author_name ?? contact.name})` : `OFF COURSE (${m.author_name ?? 'team'})`}: ${m.body}`)
      .join('\n')

    // ── Run the agent ────────────────────────────────────────────────────
    const result = await runAgenticLoop({
      feature: 'ghost_agent_inbox',
      system: OFF_COURSE_SYSTEM_PROMPT,
      tools: buildGhostTools().filter(t => t.name !== 'get_schedule'),
      submitTools: [SUBMIT_REPLY, SUBMIT_BOOKING],
      prompt: `You are the shadow inbox agent for Off Course Amsterdam. A customer sent a chat message; investigate what you need (tools), then submit the reply you WOULD send. This is SHADOW mode: nothing is sent or booked — the team compares your work against what a human actually does.

${knowledgeBlock}${correctionsBlock}CUSTOMER
- Name: ${contact.name}
- Email: ${contact.email ?? 'unknown'}
- Locale: ${contact.locale ?? 'unknown'}
- Internal notes: ${contact.notes ?? 'none'}
- Today is ${new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })} (Amsterdam)

CONVERSATION SO FAR
${transcript}

RULES
- Reply in the customer's language, chat-length, brand voice.
- Dates/availability/prices: NEVER from memory — use search_availability.
- Customer's own bookings: use get_customer_bookings with their email.
- Policies/amenities not in taught knowledge: don't invent — warm "let me check" + open_question.
- Concrete booking request + availability confirmed → submit_booking_proposal. Everything else → submit_reply_draft.`,
    })
    if (!result) return

    const parsed = validateSubmission(result.submission)
    if (!parsed) return

    const isBooking = result.submittedVia === 'submit_booking_proposal' && parsed.booking

    // ── Write the proposal — shadow status, nothing visible to customers ─
    await supabase.from('agent_proposals').insert({
      kind: isBooking ? 'booking_proposal' : 'reply_draft',
      conversation_id: conversationId,
      trigger_message_id: triggerMessageId,
      // JSON round-trip: Supabase's Json type needs index signatures that
      // AgentStep lacks; serializing guarantees a plain-JSON payload.
      payload: JSON.parse(
        JSON.stringify({
          reply: parsed.reply,
          language: parsed.language,
          open_question: parsed.open_question,
          ...(isBooking ? { booking: parsed.booking } : {}),
          steps: result.steps,
        }),
      ),
      reasoning: parsed.reasoning,
      status: 'shadow',
      model: CLAUDE_MODEL,
    })
  } catch (err) {
    // Shadow work is best-effort by definition.
    console.error('[shadow-drafter] failed:', err instanceof Error ? err.message : err)
  }
}
