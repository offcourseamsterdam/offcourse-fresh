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

    const [{ data: messages, error: msgError }, bookings] = await Promise.all([
      supabase
        .from('messages')
        .select('id, direction, body, author_name, status, error, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(500),
      loadContactBookings(supabase, conversation.contact),
    ])
    if (msgError) return apiError(msgError.message)

    // Opening the thread = reading it.
    if (conversation.unread_count > 0) {
      await supabase.from('conversations').update({ unread_count: 0 }).eq('id', id)
    }

    return apiOk({ conversation, messages: messages ?? [], bookings })
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
