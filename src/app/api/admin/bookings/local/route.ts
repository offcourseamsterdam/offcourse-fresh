import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE_SIZE = 500

/**
 * GET /api/admin/bookings/local[?offset=N]
 *
 * Returns bookings from our Supabase `bookings` table, paginated at PAGE_SIZE rows.
 * Use offset=N to fetch subsequent pages.
 *
 * Enrichments done in-memory (single extra query):
 * - customer_type_name: resolved from fareharbor_items.customer_types JSONB
 * - end_time: corrected using duration_minutes when FareHarbor returns start == end
 *   (private booking quirk — FH slot end_at equals start_at for private items)
 *
 * campaign_name + promo_code resolved via Supabase FK joins.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)

    // Fetch bookings (with FK joins for campaign + promo) + fareharbor_items in parallel
    const [bookingsResult, itemsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select(`
          id, created_at, booking_uuid, listing_id,
          customer_name, customer_email, customer_phone,
          tour_item_name, start_time, end_time, booking_date,
          guest_count, category, listing_title,
          stripe_payment_intent_id, stripe_amount, status, payment_status,
          guest_note, booking_source, deposit_amount_cents,
          extras_selected, base_amount_cents, extras_amount_cents,
          base_vat_amount_cents, extras_vat_amount_cents, total_vat_amount_cents,
          fareharbor_customer_type_rate_pk, customer_type_name,
          campaign_id, promo_code_id, discount_amount_cents,
          partner_id,
          campaigns ( name ),
          promo_codes ( code ),
          partners ( name )
        `)
        .in('status', ['confirmed', 'booked', 'pending_payment'])
        // Exclude skeleton rows created by FareHarbor's own booking.created webhook —
        // those rows have no booking_date and duplicate our own full booking record.
        // Every real booking (website, admin, stripe_recovery) always has booking_date set.
        .not('booking_date', 'is', null)
        .order('booking_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      supabase
        .from('fareharbor_items')
        .select('customer_types'),
    ])

    if (bookingsResult.error) return apiError(bookingsResult.error.message)

    // Build lookup map: customer_type_rate_pk → { name, duration_minutes }
    type CtRow = { fareharbor_pk: number; name: string; duration_minutes?: number }
    type CtInfo = { name: string; duration_minutes: number }
    const ctMap = new Map<number, CtInfo>()
    for (const item of itemsResult.data ?? []) {
      const cts = (item.customer_types ?? []) as CtRow[]
      for (const ct of cts) {
        if (ct.fareharbor_pk && ct.name) {
          ctMap.set(ct.fareharbor_pk, {
            name: ct.name,
            duration_minutes: ct.duration_minutes ?? 0,
          })
        }
      }
    }

    const bookings = (bookingsResult.data ?? []).map(b => {
      const ctInfo = b.fareharbor_customer_type_rate_pk
        ? (ctMap.get(b.fareharbor_customer_type_rate_pk) ?? null)
        : null

      // Fix end_time for private cruises: FareHarbor returns start == end for private slots.
      // Recompute from start_time + duration_minutes when that's the case.
      let endTime = b.end_time
      if (ctInfo?.duration_minutes && b.start_time) {
        const startMs = new Date(b.start_time).getTime()
        const endMs   = b.end_time ? new Date(b.end_time).getTime() : startMs
        if (Math.abs(endMs - startMs) < 60_000) { // same time = FH quirk
          endTime = new Date(startMs + ctInfo.duration_minutes * 60_000).toISOString()
        }
      }

      // Flatten FK joins
      const campaignName = (b.campaigns as { name: string } | null)?.name ?? null
      const promoCode    = (b.promo_codes as { code: string } | null)?.code ?? null
      const partnerName  = (b.partners  as { name: string } | null)?.name ?? null

      return {
        ...b,
        end_time: endTime,
        // Prefer the snapshotted label; fall back to resolving the (volatile) rate PK.
        customer_type_name: b.customer_type_name ?? ctInfo?.name ?? null,
        campaign_name: campaignName,
        promo_code: promoCode,
        partner_name: partnerName,
        campaigns: undefined,
        promo_codes: undefined,
        partners: undefined,
      }
    })

    if (bookings.length === PAGE_SIZE) {
      console.warn(`[admin/bookings] Hit PAGE_SIZE=${PAGE_SIZE} — implement client pagination when the table grows further`)
    }
    return apiOk(bookings)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
