import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { accrueCityTax, cityTaxObligations } from '@/lib/finance/cockpit/derived/city-tax'
import { loadBookingsForYear } from '@/app/api/admin/finance/cockpit/obligations/derived/city-tax/shared'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'
import { vatObligations } from '@/lib/finance/cockpit/derived/vat'
import { detectRecurring } from '@/lib/finance/cockpit/derived/recurring'
import { loadRecurringInputs } from '@/app/api/admin/finance/cockpit/obligations/derived/recurring/shared'
import {
  loadPartnerCommissionInputs,
  partnerCommissionObligations,
} from '@/lib/finance/cockpit/derived/partner-commissions'
import { upsertDerivedObligation, type DerivedObligationSyncResult } from '@/lib/finance/cockpit/derived/sync'
import type { FinanceActor } from '@/lib/finance/cockpit/events'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

const RECURRING_LOOKBACK_MONTHS = 6

export interface SyncAllResult {
  checked: number
  created: number
  updated: number
  results: DerivedObligationSyncResult[]
}

export async function syncAllDerivedObligations(
  supabase: Admin,
  actor: FinanceActor = 'cron',
): Promise<SyncAllResult> {
  const today = todayISO()
  const results: DerivedObligationSyncResult[] = []

  // ── 1. City tax ───────────────────────────────────────────────────────────
  const year = Number(today.slice(0, 4))
  const bookings = await loadBookingsForYear(supabase, year)
  const cityTaxAccrual = accrueCityTax(bookings, { year, today })
  for (const p of cityTaxObligations(cityTaxAccrual)) {
    results.push(
      await upsertDerivedObligation(
        supabase,
        {
          key: p.key,
          title: p.title,
          kind: 'tax',
          amountCents: p.amountCents,
          dueDate: p.dueDate,
          notes: 'Toeristenbelasting, automatisch berekend',
        },
        actor,
      ),
    )
  }

  // ── 2. BTW ────────────────────────────────────────────────────────────────
  const { quarters } = await computeBtwDashboard(supabase)
  for (const p of vatObligations(quarters, { today })) {
    results.push(
      await upsertDerivedObligation(
        supabase,
        {
          key: p.key,
          title: p.title,
          kind: 'tax',
          amountCents: p.amountCents,
          dueDate: p.dueDate,
          notes: 'BTW-indicatie, automatisch berekend uit het kasboek',
        },
        actor,
      ),
    )
  }

  // ── 3. Standing charges ───────────────────────────────────────────────────
  const since = addMonths(today, -RECURRING_LOOKBACK_MONTHS)
  const { inputs, existingLabels } = await loadRecurringInputs(supabase, since)
  for (const p of detectRecurring(inputs, { today, existingLabels })) {
    results.push(
      await upsertDerivedObligation(
        supabase,
        {
          key: p.key,
          title: p.label,
          kind: 'other',
          amountCents: p.amountCents,
          dueDate: p.nextExpected,
          recurrenceMonths: p.intervalMonths,
          notes: p.amountVaries
            ? `Automatisch herkend uit ${p.occurrences} afschrijvingen. Het bedrag wisselt tussen €${(p.minAmountCents / 100).toFixed(2)} en €${(p.maxAmountCents / 100).toFixed(2)}. Categoriseer in Verplichtingen beheren.`
            : `Automatisch herkend uit ${p.occurrences} afschrijvingen. Categoriseer in Verplichtingen beheren.`,
        },
        actor,
      ),
    )
  }

  // ── 4. Partner commissions ────────────────────────────────────────────────
  const partnerInputs = await loadPartnerCommissionInputs(supabase)
  for (const p of partnerCommissionObligations(partnerInputs, { today })) {
    results.push(
      await upsertDerivedObligation(
        supabase,
        {
          key: p.key,
          title: p.title,
          kind: 'contract',
          amountCents: p.amountCents,
          dueDate: p.dueDate,
          notes: `Partnercommissie over ${p.bookingCount} boeking(en), automatisch berekend uit kasboek`,
        },
        actor,
      ),
    )
  }

  const createdCount = results.filter(r => r.status === 'created').length
  const updatedCount = results.filter(r => r.status === 'updated').length

  return {
    checked: results.length,
    created: createdCount,
    updated: updatedCount,
    results,
  }
}
