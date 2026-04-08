import type { FHMinimalAvailability } from './types'

export interface CustomerTypeConfig {
  pk: number
  boat: 'diana' | 'curacao'
  duration: 90 | 120 | 180
  maxGuests: number
  priority: number // 1 for diana (smaller, try first), 2 for curacao
}

export interface BoatConfig {
  id: 'diana' | 'curacao'
  name: string
  maxGuests: number
}

export const BOATS: BoatConfig[] = [
  { id: 'diana', name: 'Diana', maxGuests: 8 },
  { id: 'curacao', name: 'Curaçao', maxGuests: 12 },
]

// ── Helpers for parsing customer type names ────────────────────────────────

function parseBoatName(name: string): 'diana' | 'curacao' {
  const lower = name.toLowerCase()
  if (lower.includes('diana')) return 'diana'
  return 'curacao'
}

function parseDurationMinutes(name: string): 90 | 120 | 180 {
  const match = name.match(/(\d+[.,]?\d*)\s*h/i)
  if (match) {
    const mins = Math.round(parseFloat(match[1].replace(',', '.')) * 60)
    if (mins === 90 || mins === 120 || mins === 180) return mins
  }
  return 120
}

function getMaxGuests(boat: 'diana' | 'curacao'): number {
  return boat === 'diana' ? 8 : 12
}

// ── Build typeMap from live availability data ──────────────────────────────

/**
 * Build a CustomerTypeConfig map from live FareHarbor availability data.
 * Keyed by customer_type.pk (the stable customer type PK, NOT the rate PK).
 *
 * This is the reliable way to populate the typeMap — it reads directly from
 * the FareHarbor API response, parsing boat name and duration from the
 * customer type's singular name (e.g. "Diana 1.5h" → boat=diana, duration=90).
 */
export function buildTypeMapFromAvailabilities(
  availabilities: FHMinimalAvailability[]
): Map<number, CustomerTypeConfig> {
  const typeMap = new Map<number, CustomerTypeConfig>()

  for (const avail of availabilities) {
    for (const rate of avail.customer_type_rates) {
      const ctPk = rate.customer_type.pk
      if (typeMap.has(ctPk)) continue

      const name = rate.customer_type.singular || rate.customer_type.plural || ''
      const boat = parseBoatName(name)
      const duration = parseDurationMinutes(name)

      typeMap.set(ctPk, {
        pk: ctPk,
        boat,
        duration,
        maxGuests: getMaxGuests(boat),
        priority: boat === 'diana' ? 1 : 2,
      })
    }
  }

  return typeMap
}

/**
 * @deprecated Use buildTypeMapFromAvailabilities() instead.
 * This always returns an empty map because the fareharbor_customer_types
 * table was dropped in migration 006.
 */
export async function getCustomerTypeMap(): Promise<Map<number, CustomerTypeConfig>> {
  return new Map()
}

export function getBoatForCustomerType(
  customerTypePk: number,
  typeMap: Map<number, CustomerTypeConfig>
): BoatConfig | undefined {
  const config = typeMap.get(customerTypePk)
  if (!config) return undefined
  return BOATS.find((b) => b.id === config.boat)
}
