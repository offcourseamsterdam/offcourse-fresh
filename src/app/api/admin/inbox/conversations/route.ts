import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'

/**
 * GET /api/admin/inbox/conversations?status=open|pending|resolved|all
 * The left pane: every conversation with its contact and latest message
 * (snippet), newest activity first.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const status = req.nextUrl.searchParams.get('status') ?? 'all'
    const supabase = createAdminClient()

    let query = supabase
      .from('conversations')
      .select(
        `id, channel, status, subject, unread_count, last_message_at, created_at, wa_window_expires_at,
         provider_thread_id, ota_source, ota_status, ota_guest_name, ota_available, ai_summary,
         contact:contacts(id, name, email, phone_e164),
         messages(body, direction, created_at),
         last_outbound:messages(created_at)`,
      )
      .order('last_message_at', { ascending: false })
      .order('created_at', { referencedTable: 'messages', ascending: false })
      .limit(1, { referencedTable: 'messages' })
      // How long since WE last replied — distinct from the snippet above
      // (latest message either direction, usually the customer's, hence
      // "waiting"). A second embed of the same table filtered to outbound,
      // bounded to 1 row per conversation by PostgREST itself — NOT a
      // separate unbounded query (see the June 2026 Supabase egress incident
      // this file's sibling route already learned this lesson from).
      .eq('last_outbound.direction', 'out')
      .order('created_at', { referencedTable: 'last_outbound', ascending: false })
      .limit(1, { referencedTable: 'last_outbound' })
      .limit(100)

    if (status !== 'all') query = query.eq('status', status)

    const { data, error } = await query
    if (error) return apiError(error.message)

    // A supplier reply thread (bookings.catering_thread_id) — same match
    // gmail/sync.ts uses to route these away from the customer-reply pipeline.
    // Bounded to this page's thread ids, same pattern as last_outbound above.
    const threadIds = (data ?? []).map(c => c.provider_thread_id).filter((t): t is string => !!t)
    // The contact's most relevant booking — shown next to their name so the
    // list reads "Susanne Hartmann — Aug 10, 15:00" instead of making Beer
    // open every thread to find out if there's a real booking behind it.
    // Matched by email OR phone (same fallback loadContactBookings in the
    // thread-detail route uses), bounded to this page's contacts.
    const emails = [...new Set((data ?? []).map(c => c.contact?.email).filter((e): e is string => !!e))]
    const phones = [...new Set((data ?? []).map(c => c.contact?.phone_e164).filter((p): p is string => !!p))]

    // None of these three depend on each other's result — all bounded to
    // this page's own ids/emails/phones, so they run together instead of
    // one-after-another.
    //
    // The email/phone queries are two separate `.in()` calls — NOT a
    // hand-built `.or()` filter string. Contact emails/phones come straight
    // from a Gmail `From:` header with no format validation (see
    // gmail/client.ts), so they must go in as parameterized array values,
    // never interpolated into PostgREST's filter-string DSL (a crafted
    // local-part could otherwise break out of an `in.(...)` list and widen
    // or corrupt the filter). `.limit(1000)` is a defensive backstop
    // against unbounded growth (the June 2026 egress incident's exact
    // shape) — not a precise per-contact bound, since PostgREST can't
    // express "top-1 per contact" without a DB function. Safe in practice:
    // no real contact at this company's scale accumulates anywhere near
    // 1000 distinct bookings, so this never truncates real data, it just
    // caps the theoretical worst case.
    const [cateringRows, emailRows, phoneRows] = await Promise.all([
      threadIds.length
        ? supabase.from('bookings').select('catering_thread_id').in('catering_thread_id', threadIds)
        : Promise.resolve({ data: [] as { catering_thread_id: string | null }[] }),
      emails.length
        ? supabase.from('bookings').select('customer_email, booking_date, start_time').in('customer_email', emails).order('booking_date', { ascending: true }).limit(1000)
        : Promise.resolve({ data: [] as { customer_email: string | null; booking_date: string | null; start_time: string | null }[] }),
      phones.length
        ? supabase.from('bookings').select('customer_phone, booking_date, start_time').in('customer_phone', phones).order('booking_date', { ascending: true }).limit(1000)
        : Promise.resolve({ data: [] as { customer_phone: string | null; booking_date: string | null; start_time: string | null }[] }),
    ])

    const cateringThreadIds = new Set<string>()
    for (const row of cateringRows.data ?? []) {
      if (row.catering_thread_id) cateringThreadIds.add(row.catering_thread_id)
    }

    const nextBookingByEmail = new Map<string, { date: string; time: string | null }>()
    const nextBookingByPhone = new Map<string, { date: string; time: string | null }>()
    if (emails.length || phones.length) {
      // Amsterdam-local "today", not UTC — near Amsterdam midnight, UTC still
      // shows the previous calendar day, which would wrongly flag yesterday's
      // booking as "upcoming" and mask a real future one (see amsterdamToday's
      // own doc comment on this exact footgun).
      const today = amsterdamToday()
      // Each row list arrives sorted by date ascending. Per contact key: the
      // first upcoming row we see is the soonest upcoming booking, and we
      // lock it in; until then, keep overwriting with each past row so we
      // land on the most recent one once an upcoming row never turns up.
      function pickNextBooking<T extends { booking_date: string | null; start_time: string | null }>(
        rows: T[],
        keyOf: (row: T) => string | null,
        map: Map<string, { date: string; time: string | null }>,
      ) {
        const lockedIn = new Set<string>()
        for (const row of rows) {
          const key = keyOf(row)
          if (!key || !row.booking_date || lockedIn.has(key)) continue
          const isUpcoming = row.booking_date >= today
          map.set(key, { date: row.booking_date, time: row.start_time })
          if (isUpcoming) lockedIn.add(key)
        }
      }
      pickNextBooking(emailRows.data ?? [], r => r.customer_email, nextBookingByEmail)
      pickNextBooking(phoneRows.data ?? [], r => r.customer_phone, nextBookingByPhone)
    }

    const conversations = (data ?? []).map(c => ({
      id: c.id,
      channel: c.channel,
      status: c.status,
      subject: c.subject,
      unread_count: c.unread_count,
      last_message_at: c.last_message_at,
      wa_window_expires_at: c.wa_window_expires_at,
      ota_source: c.ota_source,
      ota_status: c.ota_status,
      ota_guest_name: c.ota_guest_name,
      ota_available: c.ota_available,
      ai_summary: c.ai_summary,
      is_catering_thread: !!c.provider_thread_id && cateringThreadIds.has(c.provider_thread_id),
      last_outbound_at: c.last_outbound[0]?.created_at ?? null,
      next_booking:
        (c.contact?.email && nextBookingByEmail.get(c.contact.email)) ||
        (c.contact?.phone_e164 && nextBookingByPhone.get(c.contact.phone_e164)) ||
        null,
      contact: c.contact,
      snippet: c.messages[0]?.body ?? '',
      snippet_direction: c.messages[0]?.direction ?? null,
    }))

    return apiOk({ conversations })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load inbox')
  }
}
