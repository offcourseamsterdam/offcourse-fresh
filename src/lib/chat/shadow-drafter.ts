import { getClaude, CLAUDE_MODEL } from '@/lib/ai/clients'
import { OFF_COURSE_SYSTEM_PROMPT } from '@/lib/ai/context'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The Ghost — shadow-mode reply drafter (vision doc §8-B2).
 *
 * Fires after every inbound customer message. Reads the conversation, the
 * contact and their bookings FROM THE DATABASE (never the UI), asks Claude
 * what it would reply, and writes the draft into agent_proposals with
 * status 'shadow'. Nothing is sent, nobody is notified — the draft exists
 * only so we can later compare it against what the human actually said.
 *
 * Hard rule: this must NEVER break the customer flow. Every failure is
 * swallowed and logged; a missing shadow draft costs nothing.
 */
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

    // The customer's booking history — the agent should know who it's talking to.
    const contact = convo.contact
    let bookings: { booking_date: string | null; start_time: string | null; status: string | null; guest_count: number | null; listing_title: string | null }[] = []
    if (contact.email) {
      const { data } = await supabase
        .from('bookings')
        .select('booking_date, start_time, status, guest_count, listing_title')
        .eq('customer_email', contact.email)
        .order('booking_date', { ascending: false })
        .limit(5)
      bookings = data ?? []
    }

    // ── Ask the Ghost what it would do ──────────────────────────────────
    const transcript = messages
      .map(m => `${m.direction === 'in' ? `CUSTOMER (${m.author_name ?? contact.name})` : `OFF COURSE (${m.author_name ?? 'team'})`}: ${m.body}`)
      .join('\n')

    const bookingLines = bookings.length
      ? bookings.map(b => `- ${b.booking_date ?? '?'} ${b.start_time ?? ''} · ${b.listing_title ?? 'cruise'} · ${b.guest_count ?? '?'} guests · ${b.status ?? ''}`).join('\n')
      : 'No bookings found for this customer.'

    const claude = getClaude()
    const response = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: OFF_COURSE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `You are drafting a customer-support chat reply for Off Course Amsterdam. This is a SHADOW draft: it will never be sent — it is logged so the team can compare your draft against what a human actually replied. Draft it as if it WOULD be sent: reply in the customer's own language, keep it chat-length (1-3 short sentences usually), and follow the brand voice.

CUSTOMER
- Name: ${contact.name}
- Locale: ${contact.locale ?? 'unknown'}
- Internal notes: ${contact.notes ?? 'none'}

BOOKING HISTORY
${bookingLines}

CONVERSATION SO FAR
${transcript}

If answering would require information you don't have (live availability, prices, policy you're unsure of), say so in the reasoning and write the best reply you can that doesn't invent facts.

Return JSON only:
{"reply": "<the reply you would send, in the customer's language>", "reasoning": "<1-2 sentences in English: why this reply, what you'd need to verify>", "language": "<language of the reply>"}`,
        },
      ],
    })

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
    const parsed = parseDraftJson(raw)
    if (!parsed) return

    // ── Write the proposal — shadow status, nothing visible to customers ─
    await supabase.from('agent_proposals').insert({
      kind: 'reply_draft',
      conversation_id: conversationId,
      trigger_message_id: triggerMessageId,
      payload: { reply: parsed.reply, language: parsed.language },
      reasoning: parsed.reasoning,
      status: 'shadow',
      model: CLAUDE_MODEL,
    })
  } catch (err) {
    // Shadow work is best-effort by definition.
    console.error('[shadow-drafter] failed:', err instanceof Error ? err.message : err)
  }
}

/** Parse the Ghost's JSON, tolerating accidental markdown fences. */
export function parseDraftJson(raw: string): { reply: string; reasoning: string; language: string } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>
    if (typeof obj.reply !== 'string' || !obj.reply.trim()) return null
    return {
      reply: obj.reply.trim(),
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.trim() : '',
      language: typeof obj.language === 'string' ? obj.language.trim() : 'unknown',
    }
  } catch {
    return null
  }
}
