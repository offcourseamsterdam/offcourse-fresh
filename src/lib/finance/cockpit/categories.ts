/**
 * Groups the flat "Komende verplichtingen" list (obligations.ts's
 * ObligationOccurrence[]) into the categories Beer actually thinks in:
 * Rente + aflossing, BTW, Toeristenbelasting, Schippersuren, Facturen,
 * Operationele vaste kosten (verzekering + haven), Meer… (2026-09-04 request:
 * "kun je de verplichtingen ook categoriseren").
 *
 * Salaris eigenaar deliberately has NO category here — it is a stored buffer
 * (finance_settings.owner_salary_*), never a finance_obligations row, so
 * making it a category would mean summing it into obligationsTotal and
 * double-counting it against the separate owner_salary bucket the allocation
 * formula already reserves for (see compute.ts). The overview page renders
 * it as its own display-only header, sourced straight from CockpitResult.ownerSalary.
 *
 * Pure: category-of and grouping only, no fetching.
 */

import type { ObligationOccurrence } from './types'

export type ObligationCategory = 'debt' | 'vat' | 'city_tax' | 'crew' | 'commission' | 'invoice' | 'operational' | 'other'

export const CATEGORY_ORDER: ObligationCategory[] = ['debt', 'vat', 'city_tax', 'crew', 'commission', 'invoice', 'operational', 'other']

export const CATEGORY_LABELS: Record<ObligationCategory, string> = {
  debt: 'Rente + aflossing',
  vat: 'BTW',
  city_tax: 'Toeristenbelasting',
  crew: 'Schippersuren',
  commission: 'Partnercommissies',
  invoice: 'Facturen',
  operational: 'Operationele vaste kosten',
  other: 'Meer…',
}

/**
 * A `tax` obligation's source_key tells VAT and toeristenbelasting apart —
 * 'vat:YYYY-MM' (derived/vat/route.ts) vs 'city-tax:YYYY-MM' (derived/city-tax/route.ts).
 * A manually entered tax obligation has no source_key at all (Beer typed it
 * himself, nothing derived it) and falls through to 'other' — a
 * category-less tax line, nothing to guess from.
 */
function taxCategory(sourceKey: string): ObligationCategory {
  if (sourceKey.startsWith('vat:')) return 'vat'
  if (sourceKey.startsWith('city-tax:')) return 'city_tax'
  return 'other'
}

export function categoryOf(o: ObligationOccurrence): ObligationCategory {
  if (o.sourceKey?.startsWith('partner-commission:')) return 'commission'
  switch (o.kind) {
    case 'loan': return 'debt'
    case 'crew': return 'crew'
    case 'invoice': return 'invoice'
    case 'insurance': return 'operational'
    case 'berth': return 'operational'
    case 'tax': return o.sourceKey ? taxCategory(o.sourceKey) : 'other'
    // 'salary' (a real staff salary obligation, not the owner buffer) and
    // 'contract'/'other' have no dedicated bucket yet — one more of either
    // ever showing up here is the trigger to give it its own category.
    default: return 'other'
  }
}

export interface ObligationGroup {
  category: ObligationCategory
  label: string
  items: ObligationOccurrence[]
  totalCents: number
  overdueCount: number
}

/** Buckets `occurrences` into CATEGORY_ORDER, skipping any category with nothing in it. */
export function groupObligations(occurrences: ObligationOccurrence[]): ObligationGroup[] {
  const byCategory = new Map<ObligationCategory, ObligationOccurrence[]>()
  for (const o of occurrences) {
    const cat = categoryOf(o)
    const bucket = byCategory.get(cat)
    if (bucket) bucket.push(o)
    else byCategory.set(cat, [o])
  }

  return CATEGORY_ORDER.filter(cat => byCategory.has(cat)).map(cat => {
    const items = byCategory.get(cat)!
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      items,
      totalCents: items.reduce((s, o) => s + o.amountCents, 0),
      overdueCount: items.filter(o => o.overdue).length,
    }
  })
}

export interface PayeeSubgroup {
  payee: string
  items: ObligationOccurrence[]
  totalCents: number
  overdueCount: number
}

/**
 * Groups an array of occurrences by payee / supplier name.
 * Used inside "Meer…" (other) so recurring subscriptions and standing charges
 * from the same counterparty (e.g. Supabase, Simyo) sit together in a tidy sub-drawer.
 */
export function groupPayees(items: ObligationOccurrence[]): PayeeSubgroup[] {
  const map = new Map<string, ObligationOccurrence[]>()
  for (const item of items) {
    const payee = item.title.trim() || 'Overig'
    const list = map.get(payee)
    if (list) list.push(item)
    else map.set(payee, [item])
  }
  return Array.from(map.entries())
    .map(([payee, payeeItems]) => ({
      payee,
      items: payeeItems,
      totalCents: payeeItems.reduce((s, i) => s + i.amountCents, 0),
      overdueCount: payeeItems.filter(i => i.overdue).length,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.payee.localeCompare(b.payee))
}

