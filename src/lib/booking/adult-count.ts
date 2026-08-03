/**
 * Adult-count helpers for extras that can't be sold to children (e.g. Unlimited Drinks).
 *
 * FareHarbor doesn't flag a customer type as adult vs child — we infer it from the
 * type name ("Adult (13+)" vs "Child (0-12)"). This MUST be shared between the client
 * (booking panel, which shows the price) and the server (quote, which charges it), so
 * the adult count used to price an `adults_only` extra can never drift between the two.
 */

/** True when a FareHarbor customer-type name reads as a child rate. */
export function isChildLabel(name: string | null | undefined): boolean {
  const lower = (name ?? '').toLowerCase()
  return lower.includes('child') || lower.includes('(0-')
}

/**
 * Count adults in a FareHarbor booking's `customers` array — the source of truth
 * for who's actually on the boat. Used to re-price adults_only extras added after
 * the booking exists (e.g. the catering upsell), where the original adult/child
 * split isn't stored on the booking row.
 */
export function countAdultsFromFHCustomers(
  customers: Array<{ customer_type_rate?: { customer_type?: { singular?: string } } }>,
): number {
  return customers.filter(c => !isChildLabel(c.customer_type_rate?.customer_type?.singular)).length
}
