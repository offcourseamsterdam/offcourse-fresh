import { getFareHarborClient } from './client'

/**
 * Best-effort resolve of the human-readable customer-type label
 * (e.g. "Diana - 2 Hours") for an availability + customer-type-rate PK, straight
 * from FareHarbor.
 *
 * Returns null on ANY failure (network, missing rate, expired availability) — the
 * name is a nice-to-have snapshot stored on the booking, never a hard dependency
 * on the money path. Callers fall back to the booking category when it's null.
 */
export async function resolveCustomerTypeName(
  availPk: number,
  ratePk: number,
): Promise<string | null> {
  try {
    const detail = await getFareHarborClient().getAvailabilityDetail(availPk)
    const rate = detail.customer_type_rates?.find(r => r.pk === ratePk)
    return rate?.customer_type?.singular ?? null
  } catch {
    return null
  }
}
