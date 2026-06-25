import { NextRequest, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'
import { isValidExtrasToken } from '@/lib/booking/extras-token'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'
import { buildCateringEmailText, buildCateringEmailSubject } from '@/lib/catering/email-template'
import { filterCateringItems, type ExtrasLineItem } from '@/lib/catering/filter'
import { calculateExtras } from '@/lib/extras/calculate'
import type { Extra } from '@/lib/extras/calculate'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { countAdultsFromFHCustomers } from '@/lib/booking/adult-count'
import { postSlackText } from '@/lib/slack/send-notification'
import { Resend } from 'resend'

/**
 * GET /api/booking/extras/[id]?token=xxx
 *
 * Returns the booking summary + available food/drinks extras for the upsell page.
 * Validates the HMAC token — no auth session needed.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = request.nextUrl.searchParams.get('token') ?? ''

  if (!isValidExtrasToken(token, id)) return apiError('Invalid or expired link', 403)

  const supabase = createAdminClient()

  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, booking_uuid, customer_name, listing_title, listing_id, booking_date, start_time, end_time, guest_count, category, status, extras_selected, guest_note')
    .eq('id', id)
    .maybeSingle()

  if (bErr || !booking) return apiError('Booking not found', 404)
  if (!['confirmed', 'booked'].includes(booking.status ?? '')) return apiError('Booking is not active', 410)

  // Expired if cruise date has passed
  const cruiseDate = new Date(booking.booking_date ?? '')
  if (cruiseDate < new Date()) return apiError('This link has expired', 410)

  // Already ordered via this upsell?
  const existingExtras = (booking.extras_selected ?? []) as unknown as ExtrasLineItem[]
  const alreadyOrdered = existingExtras.some(e => e.source === 'extras_upsell')

  // Fetch available food + drinks extras for this listing
  const { data: extras } = await supabase
    .from('extras')
    .select('id, name, description, image_url, category, price_type, price_value, vat_rate, quantity_mode, min_quantity, min_people, adults_only, is_required, sort_order, applicable_categories, scope')
    .eq('is_active', true)
    .in('category', ['food', 'drinks'])
    .order('sort_order', { ascending: true })

  // Filter by scope: global (applicable to private category) or per-listing
  const listingId = booking.listing_id
  const { data: listingExtraIds } = listingId
    ? await supabase.from('listing_extras').select('extra_id').eq('listing_id', listingId).eq('is_enabled', true)
    : { data: [] }
  const perListingIds = new Set((listingExtraIds ?? []).map(r => r.extra_id))

  const availableExtras = (extras ?? []).filter(e => {
    if (e.scope === 'per_listing') return perListingIds.has(e.id)
    // global: applicable_categories null = all categories, otherwise must include 'private'
    const cats = e.applicable_categories as string[] | null
    return !cats || cats.includes('private') || cats.includes(booking.category ?? '')
  })

  return apiOk({
    booking: {
      id: booking.id,
      customer_name: booking.customer_name,
      listing_title: booking.listing_title,
      booking_date: booking.booking_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      guest_count: booking.guest_count,
    },
    extras: availableExtras,
    already_ordered: alreadyOrdered,
    existing_catering: alreadyOrdered ? existingExtras.filter(e => e.source === 'extras_upsell') : [],
  })
}

/**
 * POST /api/booking/extras/[id]
 * Body: { token: string, selections: { extra_id: string; quantity: number }[] }
 *
 * Saves the pre-order, updates FareHarbor booking note, notifies Slack.
 * No payment is taken — customer settles on the day.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json() as { token?: string; selections?: { extra_id: string; quantity: number }[] }
  const { token = '', selections = [] } = body

  if (!isValidExtrasToken(token, id)) return apiError('Invalid or expired link', 403)
  if (!selections.length) return apiError('No items selected', 400)

  const supabase = createAdminClient()

  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, booking_uuid, customer_name, listing_title, booking_date, start_time, end_time, guest_count, category, status, extras_selected, extras_amount_cents, extras_vat_amount_cents, total_vat_amount_cents, base_amount_cents, guest_note')
    .eq('id', id)
    .maybeSingle()

  if (bErr || !booking) return apiError('Booking not found', 404)
  if (!['confirmed', 'booked'].includes(booking.status ?? '')) return apiError('Booking is not active', 410)

  const cruiseDate = new Date(booking.booking_date ?? '')
  if (cruiseDate < new Date()) return apiError('This link has expired', 410)

  // Idempotent — reject if already ordered via upsell
  const existingExtras = (booking.extras_selected ?? []) as unknown as ExtrasLineItem[]
  if (existingExtras.some(e => e.source === 'extras_upsell')) {
    return apiError('Pre-order already submitted for this booking', 409)
  }

  // Fetch the selected extras from DB to get pricing info
  const extraIds = selections.map(s => s.extra_id)
  const { data: extrasData } = await supabase
    .from('extras')
    .select('id, name, category, price_type, price_value, vat_rate, is_required, quantity_mode, min_quantity, min_people, adults_only')
    .in('id', extraIds)
    .eq('is_active', true)

  if (!extrasData?.length) return apiError('No valid extras found', 400)

  const quantities = new Map<string, number>(selections.map(s => [s.extra_id, s.quantity]))

  // Duration in minutes for per_person_per_hour pricing
  let durationMinutes = 90
  if (booking.start_time && booking.end_time) {
    const ms = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()
    if (ms > 0) durationMinutes = Math.round(ms / 60000)
  }

  // adults_only extras (e.g. Unlimited Drinks) must be priced for adults only — a
  // child can't take unlimited alcohol. The booking row doesn't store the adult/child
  // split, so reconstruct it from the FareHarbor booking (source of truth) ONLY when it
  // matters: a shared cruise with an adults_only extra selected. Private cruises have no
  // child concept (adults = guests); failures fall back to guest_count (never under-charge).
  const guestCount = booking.guest_count ?? 2
  let adultCount = guestCount
  const needsAdultSplit = booking.category === 'shared'
    && (extrasData as Extra[]).some(e => e.adults_only)
  if (needsAdultSplit && booking.booking_uuid) {
    try {
      const fhBooking = await getFareHarborClient().getBooking(booking.booking_uuid)
      const fhCustomers = fhBooking.customers ?? []
      if (fhCustomers.length > 0) adultCount = countAdultsFromFHCustomers(fhCustomers)
    } catch (err) {
      console.error('[extras-upsell] adult-count derivation failed; using guest_count', err)
    }
  }

  const calc = calculateExtras(
    booking.base_amount_cents ?? 0,
    guestCount,
    extrasData as Extra[],
    durationMinutes,
    quantities,
    adultCount,
  )

  const newItems: ExtrasLineItem[] = calc.line_items.map(li => ({
    extra_id: li.extra_id,
    name: li.name,
    category: li.category,
    amount_cents: li.amount_cents,
    quantity: li.quantity,
    is_per_person_pick: li.is_per_person_pick,
    source: 'extras_upsell',
  }))

  const mergedExtras = [...existingExtras, ...newItems]
  const newExtrasAmountCents = (booking.extras_amount_cents ?? 0) + calc.extras_amount_cents
  const newExtrasVatCents = (booking.extras_vat_amount_cents ?? 0) + calc.extras_vat_amount_cents
  const newTotalVatCents = (booking.total_vat_amount_cents ?? 0) + calc.extras_vat_amount_cents
  const cateringItems = filterCateringItems(mergedExtras)
  const hasCatering = cateringItems.length > 0

  // Save extras + stamp catering timestamp atomically
  const { error: updateErr } = await supabase
    .from('bookings')
    .update({
      extras_selected: mergedExtras as unknown as import('@/lib/supabase/types').Json,
      extras_amount_cents: newExtrasAmountCents,
      extras_vat_amount_cents: newExtrasVatCents,
      total_vat_amount_cents: newTotalVatCents,
      ...(hasCatering ? { catering_email_sent_at: new Date().toISOString() } : {}),
    })
    .eq('id', id)

  if (updateErr) return apiError('Failed to save order', 500)

  // Side effects run after the response — must never block or crash it
  const bookingSnapshot = {
    id,
    booking_uuid: booking.booking_uuid,
    listing_title: booking.listing_title,
    booking_date: booking.booking_date,
    start_time: booking.start_time,
    guest_count: booking.guest_count,
    customer_name: booking.customer_name,
    guest_note: booking.guest_note,
  }

  after(async () => {
    // Update FareHarbor booking note (best-effort)
    if (bookingSnapshot.booking_uuid) {
      try {
        const note = buildFHBookingNote(bookingSnapshot.guest_note, mergedExtras)
        if (note) {
          const fh = getFareHarborClient()
          await fh.updateBookingNote(bookingSnapshot.booking_uuid, note)
        }
      } catch (err) {
        console.error('[extras-upsell] FH note update failed:', err)
      }
    }

    // Send catering email to supplier (best-effort)
    if (hasCatering && process.env.RESEND_API_KEY) {
      try {
        const cruiseName = bookingSnapshot.listing_title ?? 'Cruise'
        const recipient = process.env.CATERING_EMAIL_RECIPIENT ?? 'info@offcourseamsterdam.com'
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
          to: [recipient],
          subject: buildCateringEmailSubject(cruiseName, bookingSnapshot.booking_date, bookingSnapshot.start_time),
          text: buildCateringEmailText({
            cruiseName,
            dateStr: bookingSnapshot.booking_date,
            timeStr: bookingSnapshot.start_time,
            guestCount: bookingSnapshot.guest_count,
            items: cateringItems,
          }),
        })
      } catch (err) {
        console.error('[extras-upsell] catering email failed:', err)
      }
    }

    // Slack notification
    const itemSummary = newItems.map(i => `${i.name} ×${i.quantity}`).join(', ')
    const cruiseDateStr = new Date(bookingSnapshot.booking_date ?? '').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' })
    await postSlackText(
      `🍽️ *New catering pre-order* — ${bookingSnapshot.listing_title ?? 'cruise'} on ${cruiseDateStr}\n*Guest:* ${bookingSnapshot.customer_name}\n*Items:* ${itemSummary}`
    ).catch(() => {})
  })

  return apiOk({ ordered: true, items: newItems.length })
}
