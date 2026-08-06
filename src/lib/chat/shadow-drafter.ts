import { CLAUDE_DRAFTER_MODEL } from '@/lib/ai/clients'
import { OFF_COURSE_SYSTEM_PROMPT } from '@/lib/ai/context'
import { runAgenticLoop } from '@/lib/ghost/agent-runtime'
import { buildGhostTools } from '@/lib/ghost/tools'
import { autonomyForKind, levelRank } from '@/lib/ghost/agents'
import { dryRunBookingProposal } from '@/lib/ghost/dry-run'
import { translateToEnglish } from '@/lib/chat/translate'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'

/** The team reads English + Dutch; everything else gets an English translation. */
export function draftNeedsEnglish(language: string | null | undefined): boolean {
  return !!language && !/^(english|dutch|en|nl)$/i.test(language.trim())
}

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

const SUBMIT_BOOKING_CORRECTION = {
  name: 'submit_booking_correction',
  description:
    'Finish with a correction when the customer says they already have a paid booking but their contact details on file are wrong (e.g. a typo\'d email) — use ONLY after search_bookings_by_details found exactly one confident match. Includes the reply you would send plus the correction for the team to approve; the team\'s one click both fixes the record and resends the confirmation. Never use this to create a new booking — only to fix an existing one you found.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: "The reply you would send, in the customer's language (confirming you found their booking and are fixing it)." },
      language: { type: 'string', description: 'Language of the reply, in English' },
      reasoning: { type: 'string', description: '1-2 sentences in English: why this is the right booking and correction' },
      correction: {
        type: 'object',
        description: 'The correction the team would approve — booking_id must come from search_bookings_by_details, never invented.',
        properties: {
          booking_id: { type: 'string', description: 'The exact booking_id returned by search_bookings_by_details' },
          field: { type: 'string', enum: ['customer_email'], description: 'Which field is being corrected' },
          new_value: { type: 'string', description: 'The corrected value, as given by the customer' },
          booking_date: { type: 'string', description: 'The booking\'s date, from search_bookings_by_details — so the team can see which booking this is without looking it up' },
          start_time: { type: 'string', description: 'The booking\'s start time, from search_bookings_by_details' },
          listing_title: { type: 'string', description: 'The booking\'s cruise name, from search_bookings_by_details' },
          guest_count: { type: 'number', description: 'The booking\'s guest count, from search_bookings_by_details' },
        },
        required: ['booking_id', 'field', 'new_value'],
      },
      open_question: { type: ['string', 'null'], description: 'ONE question for the team if the match is uncertain. null otherwise.' },
    },
    required: ['reply', 'language', 'reasoning', 'correction'],
  },
}

export interface ReplySubmission {
  reply: string
  language: string
  reasoning: string
  open_question: string | null
  booking?: Record<string, unknown>
  correction?: Record<string, unknown>
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
    correction:
      input.correction && typeof input.correction === 'object'
        ? (input.correction as Record<string, unknown>)
        : undefined,
  }
}

export interface ShadowReplyResult {
  kind: 'reply_draft' | 'booking_proposal' | 'booking_correction'
  /** 1-2 sentences, English — for anything that wants a quick gist of what Ghost decided (e.g. the inbox list's AI summary). */
  reasoning: string
}

export async function draftShadowReply(
  conversationId: string,
  triggerMessageId: string | null,
): Promise<ShadowReplyResult | null> {
  try {
    const supabase = createAdminClient()

    // ── Read the truth ──────────────────────────────────────────────────
    const { data: convo } = await supabase
      .from('conversations')
      .select('id, channel, subject, status, contact:contacts(id, name, email, phone_e164, locale, notes)')
      .eq('id', conversationId)
      .single()
    if (!convo?.contact) return null

    const { data: messages } = await supabase
      .from('messages')
      .select('direction, body, author_name, created_at')
      .eq('conversation_id', conversationId)
      .in('direction', ['in', 'out'])
      .order('created_at', { ascending: true })
      .limit(30)
    if (!messages?.length || messages[messages.length - 1].direction !== 'in') return null

    const contact = convo.contact

    // ── The learning inputs ──────────────────────────────────────────────
    // Recency selection (newest 20) PLUS pinned facts, which are always
    // injected regardless of age — so a critical old fact (boat capacity,
    // refund policy) never silently falls off the recency window.
    const [recent, pinned] = await Promise.all([
      supabase.from('ghost_knowledge').select('question, answer').order('created_at', { ascending: false }).limit(20),
      supabase.from('ghost_knowledge').select('question, answer').eq('pinned', true),
    ])
    const seen = new Set<string>()
    const knowledge = [...(pinned.data ?? []), ...(recent.data ?? [])].filter(k => {
      if (seen.has(k.question)) return false
      seen.add(k.question)
      return true
    })
    const knowledgeBlock = knowledge.length
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
      // The inbox agent reasons about replies + bookings, not staffing — give it
      // exactly those tools (an explicit allow-list, so a new tool can't leak in).
      tools: buildGhostTools().filter(t =>
        ['search_availability', 'get_customer_bookings', 'search_bookings_by_details', 'check_booking', 'list_extras'].includes(t.name),
      ),
      submitTools: [SUBMIT_REPLY, SUBMIT_BOOKING, SUBMIT_BOOKING_CORRECTION],
      prompt: `You are the shadow inbox agent for Off Course Amsterdam. A customer sent a chat message; investigate what you need (tools), then submit the reply you WOULD send. This is SHADOW mode: nothing is sent or booked — the team compares your work against what a human actually does.

${knowledgeBlock}${correctionsBlock}CUSTOMER
- Name: ${contact.name}
- Email: ${contact.email ?? 'unknown'}
- Locale: ${contact.locale ?? 'unknown'}
- Internal notes: ${contact.notes ?? 'none'}
- Today is ${amsterdamToday()} (Amsterdam)

CONVERSATION SO FAR
${transcript}

RULES
- Reply in the customer's language, chat-length, brand voice.
- Dates/availability/prices: NEVER from memory — use search_availability.
- Customer's own bookings: use get_customer_bookings with their email.
- Policies/amenities not in taught knowledge: don't invent — warm "let me check" + open_question.
- Food, drinks, snacks, catering ("what bites/drinks can we get?"): call list_extras with the cruise slug for the real menu + prices. Offer those; say they're added at checkout on the booking page (no payment until the day). Never invent menu items or prices.
- Before you PROPOSE or PROMISE a specific booking, call check_booking to confirm FareHarbor will accept it. Only submit_booking_proposal after it says bookable.
- If check_booking comes back NOT bookable, it returns up to 3 already-validated alternatives (nearest time, the other boat, or another day). Warmly explain the asked slot is gone and offer those — in the customer's words. Never invent an option it didn't return.
- When alternatives exist: if the customer clearly wants the nearest fit AND you have their details, you may submit_booking_proposal onto the best alternative; otherwise prefer submit_reply_draft offering the options (with times + prices) and asking them to pick. Don't book a slot the customer never chose.
- A booking_proposal MUST be unambiguous: include the exact option (boat + duration, e.g. "Diana 2h") in booking.option, taken from search_availability. If the customer hasn't said which duration/boat and several fit, do NOT guess — submit_reply_draft asking them to pick, with the options + prices.
- A real booking needs the customer's name + email. If you're ready to book but don't have their email, ask for it (open_question) before promising it's done.
- If the customer says they ALREADY booked/paid but get_customer_bookings found nothing for their email, their contact details on file are probably wrong (a typo, a different address) — do NOT tell them no booking exists. Call search_bookings_by_details with their name (+ date/boat if given). If it returns exactly one confident match, submit_booking_correction with that booking_id. If it returns multiple candidates or a weak match, submit_reply_draft asking them to confirm which booking (date/boat) rather than guessing — never assume which stranger's paid booking is theirs.`,
    })
    if (!result) return null

    const parsed = validateSubmission(result.submission)
    if (!parsed) return null

    const isBooking = result.submittedVia === 'submit_booking_proposal' && parsed.booking
    const isCorrection = result.submittedVia === 'submit_booking_correction' && parsed.correction
    const kind = isBooking ? 'booking_proposal' : isCorrection ? 'booking_correction' : 'reply_draft'

    // The team reads English + Dutch — translate any other-language draft so it
    // can actually be read and approved. Off the hot path (after()); metered.
    const replyEn = draftNeedsEnglish(parsed.language)
      ? (await translateToEnglish(parsed.reply))?.translation ?? null
      : null

    // ── Write the proposal — shadow status, nothing visible to customers ─
    const { data: inserted, error: insertError } = await supabase
      .from('agent_proposals')
      .insert({
        kind,
        conversation_id: conversationId,
        trigger_message_id: triggerMessageId,
        // JSON round-trip: Supabase's Json type needs index signatures that
        // AgentStep lacks; serializing guarantees a plain-JSON payload.
        payload: JSON.parse(
          JSON.stringify({
            reply: parsed.reply,
            reply_en: replyEn,
            language: parsed.language,
            open_question: parsed.open_question,
            ...(isBooking ? { booking: parsed.booking } : {}),
            ...(isCorrection ? { correction: parsed.correction } : {}),
            steps: result.steps,
          }),
        ),
        reasoning: parsed.reasoning,
        status: 'shadow',
        model: CLAUDE_DRAFTER_MODEL,
      })
      .select('id')
      .single()

    // Without this check, a failed write here fell through silently: `inserted`
    // stays null, the dry-run below is skipped, and the function still returns
    // a "success" { kind, reasoning } as if a proposal had been saved — the
    // caller (e.g. gmail/sync.ts) then reports "Ghost drafted a reply" in the
    // AI summary while no agent_proposals row, and no reviewable card, ever
    // existed. Throwing routes this into the catch below instead: still
    // "never breaks the customer flow" (returns null, same as any other
    // failure here), but now actually logged instead of masquerading as a
    // successful draft.
    if (insertError) throw new Error(`Could not create ${kind} proposal: ${insertError.message}`)

    // Dry-run the booking proposal IF the kind's autonomy reaches dry_run:
    // validate it against FareHarbor (no booking, no email) and attach a
    // verdict. Best-effort — never blocks or breaks the shadow write.
    if (isBooking && inserted && levelRank(autonomyForKind(kind)) >= levelRank('dry_run')) {
      await dryRunBookingProposal(inserted.id)
    }

    return { kind, reasoning: parsed.reasoning }
  } catch (err) {
    // Shadow work is best-effort by definition.
    console.error('[shadow-drafter] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
