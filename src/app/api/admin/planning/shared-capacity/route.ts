import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { guessBoatFromCapacity, type SharedCapacityResult } from '@/lib/admin/shared-capacity'

/**
 * GET /api/admin/planning/shared-capacity?slots=pk1:alreadyBooked1,pk2:alreadyBooked2
 *
 * Live capacity lookup for shared-cruise departures shown on the admin
 * Planning grid. FareHarbor's booking/item data never carries capacity for
 * a slot — only the availability endpoint does — so this fetches it fresh
 * per unique availability PK rather than relying on anything synced/stored.
 * `alreadyBooked` (the guest count we already have on file for that slot)
 * lets us reconstruct the slot's full baseline capacity (spotsLeft +
 * alreadyBooked) to guess which boat it's running on.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const slotsParam = new URL(request.url).searchParams.get('slots') ?? ''
    const slots = slotsParam
      .split(',')
      .filter(Boolean)
      .map(pair => {
        const [pkStr, guestsStr] = pair.split(':')
        return { availabilityPk: Number(pkStr), alreadyBooked: Number(guestsStr) || 0 }
      })
      .filter(s => Number.isFinite(s.availabilityPk) && s.availabilityPk > 0)

    const client = getFareHarborClient()
    const results: Record<number, SharedCapacityResult> = {}

    await Promise.all(
      slots.map(async ({ availabilityPk, alreadyBooked }) => {
        try {
          const detail = await client.getAvailabilityDetail(availabilityPk)
          const spotsLeft = detail.capacity
          const fullCapacity = spotsLeft + alreadyBooked
          results[availabilityPk] = { spotsLeft, boatGuess: guessBoatFromCapacity(fullCapacity) }
        } catch {
          // FareHarbor unreachable or the slot no longer exists — skip it,
          // the card just renders without a capacity hint.
        }
      })
    )

    return apiOk(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
