import { fmtEuros } from '@/lib/utils'
import type { ExtrasCalculation } from './calculate'

/** Group VAT amounts by rate and format as "€X VAT (9%) + €Y VAT (21%)" */
export function vatSummaryText(basePriceCents: number, extrasCalculation: ExtrasCalculation | null): string {
  const groups = new Map<number, number>()
  const baseVat = extrasCalculation?.base_vat_amount_cents ?? Math.round(basePriceCents * 9 / 109)
  if (baseVat > 0) groups.set(9, baseVat)
  for (const li of extrasCalculation?.line_items ?? []) {
    if (li.vat_rate > 0 && li.vat_amount_cents > 0) {
      groups.set(li.vat_rate, (groups.get(li.vat_rate) ?? 0) + li.vat_amount_cents)
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, amount]) => `${fmtEuros(amount)} VAT (${rate}%)`)
    .join(' + ')
}
