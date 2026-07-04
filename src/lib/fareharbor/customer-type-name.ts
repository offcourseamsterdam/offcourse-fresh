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

/**
 * Human-readable label for the customer type(s) a booking selected — for the
 * Slack booking alert.
 *
 * - Single type (private, or a one-type shared): the type name, e.g. "Diana - 2 Hours".
 * - Multiple types (shared adult + child mix via `customerTypeRates`): each type
 *   with its count, e.g. "2× Adult · 1× Child".
 *
 * Best-effort: resolves names from a single FareHarbor availability lookup
 * (cached ~60s, so it piggybacks on the same detail the booking save already
 * fetched). Returns null on any failure — the Slack line is a nice-to-have,
 * never a blocker on the booking.
 */
export async function describeCustomerTypes(
  availPk: number,
  opts: {
    customerTypeRatePk?: number | null
    customerTypeRates?: Array<{ pk: number; count: number }> | null
  },
): Promise<string | null> {
  try {
    const detail = await getFareHarborClient().getAvailabilityDetail(availPk)
    const nameByPk = new Map<number, string>()
    for (const r of detail.customer_type_rates ?? []) {
      const name = r.customer_type?.singular
      if (name) nameByPk.set(r.pk, name)
    }

    const multi = (opts.customerTypeRates ?? []).filter(r => r && r.count > 0)
    if (multi.length > 0) {
      return multi
        .map(r => `${r.count}× ${nameByPk.get(Number(r.pk)) ?? `#${r.pk}`}`)
        .join(' · ')
    }

    if (opts.customerTypeRatePk) {
      return nameByPk.get(Number(opts.customerTypeRatePk)) ?? null
    }
    return null
  } catch {
    return null
  }
}
