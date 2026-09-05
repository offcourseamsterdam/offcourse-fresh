import { StatCard } from '@/components/admin/finance/cockpit/StatCard'
import { eur } from '@/components/admin/finance/cockpit/money'
import type { ExpenseSummaryResponse } from './api-types'

/**
 * Two cards, one per quarter: reclaimable purchase VAT (from Expense Records)
 * against VAT owed on sales (the BTW dashboard). Unresolved payments make the
 * reclaimable figure a floor, so the card says so instead of pretending.
 */
export function VatPositionCards({ summary }: { summary: ExpenseSummaryResponse }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {summary.vat.map(q => {
        const pos = q.positionCents
        const tone = q.conflictCount > 0 ? 'red' : q.unresolvedCount > 0 ? 'amber' : 'default'
        const notes = [
          q.pendingCents > 0 ? `${eur(q.pendingCents)} BTW wacht nog op factuur/bon (niet aftrekbaar zonder)` : null,
          q.unresolvedCount > 0 ? `${q.unresolvedCount} betaling${q.unresolvedCount === 1 ? '' : 'en'} zonder BTW-gegevens` : null,
          q.conflictCount > 0 ? `${q.conflictCount} BTW-conflict${q.conflictCount === 1 ? '' : 'en'}` : null,
        ].filter(Boolean).join(' · ')
        return (
          <StatCard
            key={q.quarter}
            title={`BTW-positie ${q.label}`}
            value={pos == null ? eur(q.reclaimableCents) : eur(Math.abs(pos))}
            subtitle={
              pos == null
                ? `Te vorderen voorbelasting${q.payableCents == null ? ' · verkoopkant onbekend' : ''}`
                : `${pos >= 0 ? 'Te betalen' : 'Terug te krijgen'} · ${eur(q.payableCents)} verkoop − ${eur(q.reclaimableCents)} inkoop`
            }
            tone={tone}
            note={notes || undefined}
          />
        )
      })}
    </div>
  )
}
