/**
 * pi-metadata.ts
 *
 * Small pure-ish helpers for reading a Stripe PaymentIntent's metadata and the
 * stored pricing quote. Extracted from the (now-removed) recover-from-pi.ts so
 * the Stripe webhook — the single booking finalizer — can share them without
 * depending on the deleted recovery module.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type ExtraLineItem = {
  name: string
  amount_cents: number
  category?: string
  extra_id?: string
  quantity?: number
  is_per_person_pick?: boolean
  vat_rate?: number
  vat_amount_cents?: number
}

/**
 * Parse a cents amount from PI metadata (all metadata values are strings).
 * Returns null when the field is absent/empty/garbage so the caller can fall
 * back to a server-side computation — but, unlike `Number(x) || fallback`,
 * an explicit "0" is respected as a real zero.
 */
export function parseMetaCents(value: string | undefined): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Fetch extras line items from the stored quote breakdown. */
export async function getExtrasFromQuote(quoteId: string | undefined): Promise<ExtraLineItem[]> {
  if (!quoteId) return []
  try {
    const supabase = createAdminClient()
    const { data: quoteRow } = await supabase
      .from('pricing_quotes')
      .select('breakdown')
      .eq('id', quoteId)
      .maybeSingle()

    if (!quoteRow?.breakdown) return []

    type Breakdown = {
      extrasCalculation?: {
        line_items?: Array<{
          name?: string
          amount_cents?: number
          category?: string
          extra_id?: string
          quantity?: number
          is_per_person_pick?: boolean
          vat_rate?: number
          vat_amount_cents?: number
        }>
      }
    }
    const bd = quoteRow.breakdown as Breakdown
    return (bd.extrasCalculation?.line_items ?? [])
      .filter(li => Boolean(li.name) && typeof li.amount_cents === 'number' && li.amount_cents > 0)
      .map(li => ({
        name: li.name!,
        amount_cents: li.amount_cents!,
        ...(li.category ? { category: li.category } : {}),
        ...(li.extra_id ? { extra_id: li.extra_id } : {}),
        ...(li.quantity != null ? { quantity: li.quantity } : {}),
        ...(li.is_per_person_pick ? { is_per_person_pick: true } : {}),
        ...(li.vat_rate != null ? { vat_rate: li.vat_rate } : {}),
        ...(li.vat_amount_cents != null ? { vat_amount_cents: li.vat_amount_cents } : {}),
      }))
  } catch {
    return []
  }
}
