import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * One conversation, fully loaded — the middle and right panes.
 *
 *   GET   — contact + all messages (incl. internal notes) + the contact's
 *           bookings (matched by email). Opening a thread marks it read.
 *   PATCH — { status } workflow changes (open|pending|resolved).
 */

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select(
        `id, channel, status, subject, unread_count, last_message_at, created_at, booking_id,
         contact:contacts(id, name, email, phone_e164, locale, notes)`,
      )
      .eq('id', id)
      .maybeSingle()
    if (error) return apiError(error.message)
    if (!conversation) return apiError('Conversation not found', 404)

    const [{ data: messages, error: msgError }, bookings, ghost] = await Promise.all([
      supabase
        .from('messages')
        .select('id, direction, body, author_name, status, error, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(500),
      loadContactBookings(supabase, conversation.contact),
      loadGhostProposals(supabase, id),
    ])
    if (msgError) return apiError(msgError.message)

    // Opening the thread = reading it.
    if (conversation.unread_count > 0) {
      await supabase.from('conversations').update({ unread_count: 0 }).eq('id', id)
    }

    return apiOk({ conversation, messages: messages ?? [], bookings, ghost })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load conversation')
  }
}

/** The contact's booking history: matched by email, then phone as fallback. */
async function loadContactBookings(
  supabase: ReturnType<typeof createAdminClient>,
  contact: { email: string | null; phone_e164: string | null } | null,
) {
  if (!contact?.email && !contact?.phone_e164) return []
  const filters = []
  if (contact.email) filters.push(`customer_email.eq.${contact.email}`)
  if (contact.phone_e164) filters.push(`customer_phone.eq.${contact.phone_e164}`)

  const { data } = await supabase
    .from('bookings')
    .select(
      'id, booking_id, booking_date, start_time, status, guest_count, listing_title, receipt_total_display',
    )
    .or(filters.join(','))
    .order('booking_date', { ascending: false })
    .limit(10)
  return data ?? []
}

/** The narrowed columns we pull per proposal — never the whole payload/outcome. */
interface NarrowedGhostRow {
  id: string
  kind: 'reply_draft' | 'booking_proposal'
  status: string
  reasoning: string | null
  created_at: string
  reply: string | null
  reply_en: string | null
  language: string | null
  booking: Record<string, unknown> | null
  verdict: Record<string, unknown> | null
  human_reply: string | null
  comparison: Record<string, unknown> | null
}

/**
 * The Ghost's latest unactioned suggestions for this conversation (P0 co-pilot):
 * the newest reply_draft and the newest booking_proposal, surfaced in the inbox
 * so the human can act on them where the work happens.
 *
 * This runs on the 5s thread poll, so we select ONLY the JSON sub-keys the
 * co-pilot renders — never the whole `payload`, which also carries the agent's
 * full `steps` blob (every tool call + availability dump, multiple KB/row). At
 * 20 rows × every 5s × every open thread that is the unbounded-fetch-on-a-poll
 * shape behind the June 2026 Supabase egress incident. The narrowed columns are
 * re-nested below into the exact payload/outcome shape the inbox already expects,
 * so the API contract (and InboxGhostProposal) is unchanged.
 */
async function loadGhostProposals(supabase: ReturnType<typeof createAdminClient>, conversationId: string) {
  const { data } = await supabase
    .from('agent_proposals')
    .select(
      `id, kind, status, reasoning, created_at,
       reply:payload->>reply, reply_en:payload->>reply_en, language:payload->>language,
       booking:payload->booking, verdict:payload->verdict,
       human_reply:outcome->>human_reply, comparison:outcome->comparison`,
    )
    .eq('conversation_id', conversationId)
    .in('kind', ['reply_draft', 'booking_proposal'])
    .order('created_at', { ascending: false })
    .limit(20)

  // Re-nest the narrowed columns into the payload/outcome shape the panes read.
  const rows = ((data ?? []) as unknown as NarrowedGhostRow[]).map(r => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    reasoning: r.reasoning,
    created_at: r.created_at,
    payload: {
      reply: r.reply ?? undefined,
      reply_en: r.reply_en,
      language: r.language ?? undefined,
      booking: r.booking ?? undefined,
      verdict: r.verdict ?? undefined,
    },
    outcome:
      r.human_reply || r.comparison
        ? { human_reply: r.human_reply ?? undefined, comparison: r.comparison ?? undefined }
        : null,
  }))

  return {
    // The current things to act on:
    replyDraft: rows.find(r => r.kind === 'reply_draft') ?? null,
    bookingProposal: rows.find(r => r.kind === 'booking_proposal') ?? null,
    // The learning trail: past drafts the human already replied to — draft vs
    // what was actually sent, so the feedback loop is visible in the inbox.
    history: rows.filter(r => r.outcome?.human_reply),
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    const status = body?.status
    if (!['open', 'pending', 'resolved'].includes(status)) {
      return apiError('status must be open, pending or resolved', 400)
    }

    const supabase = createAdminClient()
    const { error } = await supabase.from('conversations').update({ status }).eq('id', id)
    if (error) return apiError(error.message)

    return apiOk({ updated: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to update conversation')
  }
}
