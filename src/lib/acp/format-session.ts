import type { AcpSessionRow } from './session-store'
import type { CheckoutLineItem, CheckoutMessage, CheckoutSession } from './types'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

/** Formats a stored session row into the JSON shape the ACP Checkout API returns. */
export function formatSession(row: AcpSessionRow): CheckoutSession {
  const lineItems = (row.line_items as CheckoutLineItem[] | null) ?? []
  const subtotalCents = lineItems.reduce((sum, li) => sum + li.totals[0].amount, 0)
  const totalCents = row.total_cents ?? subtotalCents
  const cityTaxCents = totalCents - subtotalCents

  return {
    id: row.id,
    status: row.status,
    currency: 'eur',
    line_items: lineItems,
    fulfillment_options: [],
    totals: [
      { type: 'subtotal', display_text: 'Subtotal', amount: subtotalCents },
      ...(cityTaxCents > 0 ? [{ type: 'tax' as const, display_text: 'City tax', amount: cityTaxCents }] : []),
      { type: 'total', display_text: 'Total', amount: totalCents },
    ],
    messages: (row.messages as CheckoutMessage[] | null) ?? [],
    links: [{ type: 'terms_of_service', title: 'Cancellation policy', url: `${SITE_URL}/en/terms` }],
  }
}
