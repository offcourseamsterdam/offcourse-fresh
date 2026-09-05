import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { addMonths, todayISO } from '@/lib/finance/cockpit/dates'
import { accrueCityTax, cityTaxObligations } from '@/lib/finance/cockpit/derived/city-tax'
import { loadBookingsForYear } from '@/app/api/admin/finance/cockpit/obligations/derived/city-tax/shared'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'
import { vatObligations } from '@/lib/finance/cockpit/derived/vat'
import { detectRecurring } from '@/lib/finance/cockpit/derived/recurring'
import { loadRecurringInputs } from '@/app/api/admin/finance/cockpit/obligations/derived/recurring/shared'
import { upsertDerivedObligation, type DerivedObligationSyncResult } from '@/lib/finance/cockpit/derived/sync'

export const dynamic = 'force-dynamic'

const RECURRING_LOOKBACK_MONTHS = 6

/**
 * GET /api/cron/finance-sync-derived-obligations — nightly.
 *
 * Beer, 2026-09-05: extends the skipper-hours auto-sync to the other three
 * derived-obligation sources (§12b) he approved for it — city tax, BTW, and
 * standing charges. Same idempotent upsert (upsertDerivedObligation), just
 * three different sources of proposals:
 *
 *  - City tax and BTW deliberately sync the CURRENT, still-running period
 *    too, not just closed ones (plan §12b rule 3: "hiding it until the
 *    quarter closes is the exact error this exists to prevent") — unlike
 *    skipper-hours, whose still-open month stays manual-only. Both already
 *    label a running period's title "loopt nog" so it reads as provisional.
 *  - Standing charges sync as kind='other': the detector groups bank
 *    transactions by counterparty/label/interval only — it has no reliable
 *    signal for "is this insurance or a berth fee", so guessing a kind here
 *    would be inventing a classification, not detecting one. They land
 *    under "Meer…" until reclassified by hand in the obligations modal
 *    (editing amount_cents there doesn't fight this cron: 'other' obligations
 *    it created are still 'open' rows with a source_key, so a nightly re-sync
 *    still updates the amount if it changed — only the human-picked kind
 *    survives an edit, because a kind edit isn't tracked as part of the sync
 *    key and this cron only ever writes amount_cents/notes on an update).
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const today = todayISO()
    const results: DerivedObligationSyncResult[] = []

    // ── City tax ────────────────────────────────────────────────────────────
    const year = Number(today.slice(0, 4))
    const bookings = await loadBookingsForYear(supabase, year)
    const cityTaxAccrual = accrueCityTax(bookings, { year, today })
    for (const p of cityTaxObligations(cityTaxAccrual)) {
      results.push(await upsertDerivedObligation(supabase, { key: p.key, title: p.title, kind: 'tax', amountCents: p.amountCents, dueDate: p.dueDate, notes: 'Toeristenbelasting, automatisch berekend' }, 'cron'))
    }

    // ── BTW ─────────────────────────────────────────────────────────────────
    const { quarters } = await computeBtwDashboard(supabase)
    for (const p of vatObligations(quarters, { today })) {
      results.push(await upsertDerivedObligation(supabase, { key: p.key, title: p.title, kind: 'tax', amountCents: p.amountCents, dueDate: p.dueDate, notes: 'BTW-indicatie, automatisch berekend uit het kasboek' }, 'cron'))
    }

    // ── Standing charges ────────────────────────────────────────────────────
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
          'cron',
        ),
      )
    }

    const createdCount = results.filter(r => r.status === 'created').length
    const updatedCount = results.filter(r => r.status === 'updated').length

    if (createdCount > 0 || updatedCount > 0) {
      const lines = [`🧭 *Afgeleide verplichtingen gesynchroniseerd* (toeristenbelasting, BTW, vaste lasten)`]
      if (createdCount > 0) lines.push(`• ${createdCount} nieuw`)
      if (updatedCount > 0) lines.push(`• ${updatedCount} bijgewerkt`)
      await postSlackOps(lines.join('\n'))
    }

    return NextResponse.json({ ok: true, checked: results.length, created: createdCount, updated: updatedCount })
  } catch (err) {
    await alertCronFailure('finance-sync-derived-obligations', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
