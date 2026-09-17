/**
 * Types for the Agentic Commerce Protocol (ACP — https://agenticcommerce.dev),
 * the merchant-implemented Checkout Sessions API that lets an AI agent
 * complete a real purchase via a Stripe Shared Payment Token (SPT).
 *
 * Scope: this site sells scheduled cruise slots, not shippable goods, so
 * there is no fulfillment/shipping step — `fulfillment_options` is always
 * empty and totals never include a fulfillment or tax line (cruise prices
 * are displayed VAT-inclusive everywhere else on the site; ACP checkout
 * matches that, same as the regular booking flow).
 */

/** The API-Version this server implements and requires on every request. */
export const ACP_VERSION = '2026-01-30'

export type CheckoutSessionStatus =
  | 'not_ready_for_payment'
  | 'ready_for_payment'
  | 'complete_in_progress'
  | 'completed'
  | 'canceled'
  | 'authentication_required'

export interface CheckoutItemInput {
  id: string
  quantity: number
}

export interface CheckoutTotal {
  type: 'subtotal' | 'tax' | 'total'
  display_text: string
  amount: number
}

export interface CheckoutLineItem {
  id: string
  item: { id: string; name: string; unit_amount: number }
  quantity: number
  unit_amount: number
  totals: CheckoutTotal[]
}

export interface CheckoutMessage {
  type: 'info' | 'warning' | 'error'
  content: string
  code?: string
  param?: string
}

export interface CheckoutSession {
  id: string
  status: CheckoutSessionStatus
  currency: 'eur'
  line_items: CheckoutLineItem[]
  fulfillment_options: []
  totals: CheckoutTotal[]
  messages: CheckoutMessage[]
  links: Array<{ type: string; title: string; url: string }>
}
