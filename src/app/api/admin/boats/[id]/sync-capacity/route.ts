import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { parseCapacityFromNote } from '@/lib/fareharbor/customer-type-capacity'

/**
 * POST /api/admin/boats/[id]/sync-capacity
 *
 * Pulls the boat's real max guest capacity from FareHarbor instead of relying
 * on whatever was last typed into the admin field. There's no numeric
 * capacity field for this on FareHarbor's side (see fareharbor-no-resource-field
 * memory) — the only place it exists is the free-text note on a private
 * customer type ("Up to 8 people"), keyed by the customer type PKs already
 * stored on the boat. Those PKs are catalog-level (customer_type.pk), not the
 * per-availability rate PK, so they're stable to search by across items.
 *
 * Tries every active FareHarbor item (a boat's customer types could live on
 * any of them — the main year-round item, a seasonal one, etc.) until one
 * has a matching customer type, rather than assuming a single hardcoded item.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: boat, error: boatError } = await supabase
      .from('boats')
      .select('id, fareharbor_customer_type_pks')
      .eq('id', id)
      .single()

    if (boatError || !boat) return apiError('Boat not found', 404)

    const pks = (boat.fareharbor_customer_type_pks ?? []).map(Number)
    if (pks.length === 0) {
      return apiError('This boat has no FareHarbor customer type PKs set — add those first', 400)
    }

    const { data: items } = await supabase
      .from('fareharbor_items')
      .select('fareharbor_pk')
      .eq('is_active', true)

    if (!items || items.length === 0) return apiError('No active FareHarbor items found', 404)

    const client = getFareHarborClient()
    const today = new Date()
    const startDate = today.toISOString().split('T')[0]
    const endDate = new Date(today.getTime() + 6 * 86400000).toISOString().split('T')[0]

    // Fetch every item's availabilities concurrently — up to 6 items would
    // otherwise mean 6 sequential FareHarbor round-trips (~10s total) for
    // what's a single button click. All independent, so no reason to wait.
    const perItemAvailabilities = await Promise.all(
      items.map(item =>
        client.getAvailabilitiesDateRange(item.fareharbor_pk, startDate, endDate).catch(() => [])
      )
    )

    for (const availabilities of perItemAvailabilities) {
      for (const avail of availabilities) {
        const rate = avail.customer_type_rates.find(r => pks.includes(r.customer_type.pk))
        if (!rate) continue
        const capacity = parseCapacityFromNote(rate.customer_type.note)
        if (!capacity) continue

        const { error: updateError } = await supabase
          .from('boats')
          .update({ max_capacity: capacity })
          .eq('id', id)
        if (updateError) return apiError(updateError.message)

        return apiOk({ max_capacity: capacity, note: rate.customer_type.note })
      }
    }

    return apiError('Could not find a matching FareHarbor customer type in any active item this week — try again on a day the boat actually has slots', 404)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
