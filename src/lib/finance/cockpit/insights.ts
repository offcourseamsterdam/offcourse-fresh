/**
 * "Wat vraagt aandacht?" — the actionable list on the dashboard.
 *
 * The PRD is explicit (§42): only things worth doing something about. So this
 * deliberately says nothing when everything is fine, rather than filling the
 * card with analytics. Every insight carries a severity, a sentence in Beer's
 * language, and where to go to act on it.
 *
 * Pure. The sentences are the product here, so they are asserted in the tests.
 */

import { daysBetween, type ISODate } from './dates'
import type { CockpitResult } from './types'

export type InsightLevel = 'critical' | 'warning' | 'info'

export interface Insight {
  key: string
  level: InsightLevel
  message: string
  /** Where the fix lives, as an admin path relative to /admin. */
  href?: string
  actionLabel?: string
}

export interface InsightInput {
  cockpit: CockpitResult
  /** Transactions the classifier could not place, or flagged for review. */
  unclassifiedCount?: number
  needsReviewCount?: number
  largestUnreviewedCents?: number
  /** Difference between the bank balance and what our ledger explains. */
  reconciliationGapCents?: number
  /** Set when the Revolut sync last failed. */
  syncError?: string | null
  lastSyncAt?: string | null
  now?: ISODate
  /** Completed cruises older than this many days with no skipper invoice (Phase 4). */
  missingInvoiceCount?: number
}

const SYNC_STALE_HOURS = 6
const ATTENTION_DAYS = 14

export function buildInsights(input: InsightInput): Insight[] {
  const { cockpit } = input
  const out: Insight[] = []
  const today = input.now ?? cockpit.today

  // ── Critical: the numbers cannot be trusted or the money does not fit ──────
  if (input.syncError) {
    out.push({
      key: 'sync-error',
      level: 'critical',
      message: `De koppeling met Revolut gaf een fout: ${input.syncError}. Je saldo kan verouderd zijn.`,
      href: '/finance/overview',
      actionLabel: 'Opnieuw synchroniseren',
    })
  } else if (cockpit.cash.source === 'revolut' && input.lastSyncAt) {
    const hours = (Date.parse(today + 'T23:59:59Z') - Date.parse(input.lastSyncAt)) / 3_600_000
    if (hours > SYNC_STALE_HOURS * 4) {
      out.push({
        key: 'sync-stale',
        level: 'warning',
        message: 'Er is al meer dan een dag niet met de bank gesynchroniseerd.',
        href: '/finance/overview',
        actionLabel: 'Ververs',
      })
    }
  }

  if ((input.reconciliationGapCents ?? 0) !== 0) {
    const gap = Math.abs(input.reconciliationGapCents as number)
    out.push({
      key: 'reconciliation-gap',
      level: 'critical',
      message: `Er zit €${eur(gap)} verschil tussen je banksaldo en wat wij kunnen verklaren. Dat wordt niet als vrije ruimte meegeteld.`,
      href: '/finance/transactions',
      actionLabel: 'Bekijk transacties',
    })
  }

  if (cockpit.cash.source === 'none') {
    out.push({
      key: 'no-cash',
      level: 'critical',
      message: 'Er is nog geen saldo bekend, dus alle bedragen hieronder zijn nog niet betrouwbaar.',
      href: '/finance/overview',
      actionLabel: 'Koppel Revolut',
    })
  }

  const overdue = cockpit.obligations.filter(o => o.overdue)
  if (overdue.length > 0) {
    const total = overdue.reduce((s, o) => s + o.amountCents, 0)
    out.push({
      key: 'overdue-obligations',
      level: 'critical',
      message: overdue.length === 1
        ? `${overdue[0].title} had op ${nl(overdue[0].dueDate)} betaald moeten zijn (€${eur(overdue[0].amountCents)}).`
        : `${overdue.length} verplichtingen staan over tijd, samen €${eur(total)}.`,
      href: '/finance/overview',
      actionLabel: 'Bekijk verplichtingen',
    })
  }

  if (cockpit.reserveOverrunCents > 0) {
    out.push({
      key: 'reserve-overrun',
      level: 'critical',
      message: `Je reserveringen zijn €${eur(cockpit.reserveOverrunCents)} hoger dan je werkelijke saldo. Verlaag een doel, de salarisdekking of de operationele dekking.`,
      href: '/finance/goals',
      actionLabel: 'Naar doelen',
    })
  }

  // ── Warnings: it still fits, but something needs attention soon ───────────
  const soon = cockpit.obligations.filter(o => !o.overdue && daysBetween(today, o.dueDate) <= ATTENTION_DAYS)
  const obligationsBucket = cockpit.buckets.find(b => b.key === 'obligations')
  if (soon.length > 0 && (obligationsBucket?.shortfallCents ?? 0) > 0) {
    const total = soon.reduce((s, o) => s + o.amountCents, 0)
    out.push({
      key: 'obligations-due-soon',
      level: 'warning',
      message: `Binnen ${ATTENTION_DAYS} dagen moet er €${eur(total)} betaald worden en dat past niet volledig in je huidige saldo.`,
      href: '/finance/overview',
    })
  }

  if (cockpit.marginShortfallCents > 0) {
    out.push({
      key: 'below-safety-margin',
      level: 'warning',
      message: `Je financiële ruimte ligt €${eur(cockpit.marginShortfallCents)} onder je gewenste veiligheidsmarge van €${eur(cockpit.safetyMarginCents)}.`,
      href: '/finance/overview',
    })
  }

  const behind = cockpit.goals.filter(g => g.behindCents > 0)
  if (behind.length === 1) {
    out.push({
      key: `goal-behind:${behind[0].id}`,
      level: 'warning',
      message: `${behind[0].name} loopt €${eur(behind[0].behindCents)} achter op schema.`,
      href: '/finance/goals',
    })
  } else if (behind.length > 1) {
    const total = behind.reduce((s, g) => s + g.behindCents, 0)
    out.push({
      key: 'goals-behind',
      level: 'warning',
      message: `${behind.length} doelen lopen samen €${eur(total)} achter op schema.`,
      href: '/finance/goals',
    })
  }

  const salary = cockpit.ownerSalary
  if (salary.monthlyCents > 0 && salary.monthsCovered < 1) {
    out.push({
      key: 'owner-salary-thin',
      level: 'warning',
      message: `Je eigenaarssalaris is nog geen maand gedekt (€${eur(salary.coverageCents)} van €${eur(salary.targetCents)}).`,
      href: '/finance/overview',
    })
  }

  if ((input.needsReviewCount ?? 0) > 0) {
    const n = input.needsReviewCount as number
    const largest = input.largestUnreviewedCents ?? 0
    out.push({
      key: 'needs-review',
      level: largest >= 500_000 ? 'warning' : 'info',
      message: n === 1
        ? `1 transactie moet nog gecontroleerd worden${largest > 0 ? ` (€${eur(largest)})` : ''}.`
        : `${n} transacties moeten nog gecontroleerd worden${largest > 0 ? `, de grootste is €${eur(largest)}` : ''}.`,
      href: '/finance/transactions?needs_review=true',
      actionLabel: 'Controleren',
    })
  }

  if ((input.missingInvoiceCount ?? 0) > 0) {
    const n = input.missingInvoiceCount as number
    out.push({
      key: 'missing-skipper-invoices',
      level: 'warning',
      message: n === 1
        ? 'Van één gevaren tocht is nog geen schippersfactuur binnen.'
        : `Van ${n} gevaren tochten is nog geen schippersfactuur binnen.`,
      // §6a: invoice review lives in the operations inbox, not a finance sub-page.
      href: '/inbox',
    })
  }

  // ── Info: the one number Beer opened the page for ─────────────────────────
  if ((input.unclassifiedCount ?? 0) > 0) {
    out.push({
      key: 'unclassified',
      level: 'info',
      message: `${input.unclassifiedCount} transacties zijn nog niet ingedeeld.`,
      href: '/finance/transactions',
    })
  }

  if (out.length === 0 && cockpit.availableForGrowthCents > 0) {
    out.push({
      key: 'available-for-growth',
      level: 'info',
      message: `Alles is gedekt. Je hebt €${eur(cockpit.availableForGrowthCents)} beschikbaar voor groei.`,
      href: '/finance/investments',
    })
  }

  return out
}

const LEVEL_ORDER: Record<InsightLevel, number> = { critical: 0, warning: 1, info: 2 }

export function sortInsights(insights: Insight[]): Insight[] {
  return [...insights].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))
}

function nl(date: ISODate): string {
  const [y, m, d] = date.split('-')
  return `${d}-${m}-${y}`
}
