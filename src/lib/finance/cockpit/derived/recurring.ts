/**
 * Finding the standing charges hiding in the bank feed.
 *
 * Insurance, berth fees and every software subscription leave the account on
 * their own rhythm. Typing them all into the obligations list by hand is work
 * nobody does, so the cockpit would keep under-reporting what is already
 * committed. The feed already knows: the same counterparty, a steady interval,
 * a stable amount.
 *
 * This proposes, it never creates. A detected pattern is a suggestion Beer
 * confirms, because silently turning a habit into a commitment would
 * double-count against anything he entered himself.
 *
 * Two details the real feed forced:
 *   - One name can hide two subscriptions (Supabase bills on the 8th and the
 *     12th). Occurrences are therefore clustered by day of month first, and
 *     each cluster judged on its own, instead of reading the alternating gaps
 *     as one irregular mess.
 *   - Two payments on the same day are one event, not an interval of zero
 *     days: a berth fee settled in two instalments would otherwise look like
 *     a daily charge.
 *
 * Pure.
 */

import { addMonths, daysBetween, type ISODate } from '../dates'

export interface RecurringInput {
  id: string
  /** Counterparty or merchant name; the grouping key. */
  label: string
  date: ISODate
  /** Positive number of cents that left the account. */
  amountCents: number
  category?: string | null
  subcategory?: string | null
}

export type RecurrenceInterval = 1 | 3 | 6 | 12

export interface RecurringProposal {
  key: string
  label: string
  intervalMonths: RecurrenceInterval
  /** What to budget: the most recent amount, which is what will be charged next. */
  amountCents: number
  /** Spread across observations, so a variable charge is visibly variable. */
  minAmountCents: number
  maxAmountCents: number
  amountVaries: boolean
  occurrences: number
  firstSeen: ISODate
  lastSeen: ISODate
  nextExpected: ISODate
  /** 0..1. Rises with the number of observations and the steadiness of the amount. */
  confidence: number
  category: string | null
  subcategory: string | null
}

export interface DetectOptions {
  today: ISODate
  /** Below this a pattern is a coincidence, not a rhythm. */
  minOccurrences?: number
  /** Names already covered by an obligation, so we do not propose them twice. */
  existingLabels?: string[]
  /** Ignore charges too small to be worth planning around. */
  minAmountCents?: number
}

// A direct debit shifts a day or two for weekends, but not more. Four would
// merge Supabase's 8th-of-the-month and 12th-of-the-month subscriptions into
// one unreadable series.
const DAY_TOLERANCE = 3
const AMOUNT_VARIES_RATIO = 0.15

const INTERVAL_DAYS: Record<RecurrenceInterval, number> = { 1: 30.44, 3: 91.31, 6: 182.6, 12: 365.25 }

function norm(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Collapses same-day charges into a single event, summing what left that day. */
function collapseSameDay(rows: RecurringInput[]): Array<{ date: ISODate; amountCents: number }> {
  const byDate = new Map<ISODate, number>()
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amountCents)
  return [...byDate.entries()]
    .map(([date, amountCents]) => ({ date, amountCents }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Splits one counterparty's events into series that share a day of month, so
 * two subscriptions billed by the same vendor are judged separately.
 */
export function clusterByDayOfMonth(events: Array<{ date: ISODate; amountCents: number }>): Array<Array<{ date: ISODate; amountCents: number }>> {
  const clusters: Array<{ day: number; items: Array<{ date: ISODate; amountCents: number }> }> = []
  for (const e of events) {
    const day = Number(e.date.slice(8, 10))
    const near = clusters.find(c => {
      const diff = Math.abs(c.day - day)
      // Wrap around the month end: the 30th and the 1st are two days apart.
      return Math.min(diff, 31 - diff) <= DAY_TOLERANCE
    })
    if (near) {
      near.items.push(e)
      near.day = Math.round(near.items.reduce((s, i) => s + Number(i.date.slice(8, 10)), 0) / near.items.length)
    } else {
      clusters.push({ day, items: [e] })
    }
  }
  return clusters.map(c => c.items)
}

/** The interval every gap agrees on, or null when they do not agree. */
export function detectInterval(events: Array<{ date: ISODate }>): RecurrenceInterval | null {
  if (events.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < events.length; i++) gaps.push(daysBetween(events[i - 1].date, events[i].date))
  if (gaps.some(g => g <= 0)) return null

  const candidates: RecurrenceInterval[] = [1, 3, 6, 12]
  for (const interval of candidates) {
    const expected = INTERVAL_DAYS[interval]
    // Every gap must be within a few days of the interval, allowing for
    // month lengths and weekends shifting a direct debit.
    const tolerance = Math.max(5, expected * 0.18)
    if (gaps.every(g => Math.abs(g - expected) <= tolerance)) return interval
  }
  return null
}

export function detectRecurring(rows: RecurringInput[], opts: DetectOptions): RecurringProposal[] {
  const minOccurrences = opts.minOccurrences ?? 3
  const minAmount = opts.minAmountCents ?? 500
  const existing = new Set((opts.existingLabels ?? []).map(norm))

  const byLabel = new Map<string, RecurringInput[]>()
  for (const r of rows) {
    if (r.amountCents < minAmount) continue
    const key = norm(r.label)
    if (!key || existing.has(key)) continue
    const list = byLabel.get(key)
    if (list) list.push(r)
    else byLabel.set(key, [r])
  }

  const proposals: RecurringProposal[] = []
  for (const [key, rows_] of byLabel.entries()) {
    const events = collapseSameDay(rows_)
    if (events.length < minOccurrences) continue

    for (const [index, cluster] of clusterByDayOfMonth(events).entries()) {
      if (cluster.length < minOccurrences) continue
      const interval = detectInterval(cluster)
      if (!interval) continue

      const amounts = cluster.map(c => c.amountCents)
      const min = Math.min(...amounts)
      const max = Math.max(...amounts)
      const last = cluster[cluster.length - 1]
      const varies = max > 0 && (max - min) / max > AMOUNT_VARIES_RATIO

      // More sightings and a steadier amount both raise trust in the pattern.
      const countScore = Math.min(1, cluster.length / 4)
      const steadiness = max > 0 ? 1 - Math.min(1, (max - min) / max) : 1
      const confidence = Math.round((0.6 * countScore + 0.4 * steadiness) * 100) / 100

      proposals.push({
        key: `recurring:${key}${index > 0 ? `:${index}` : ''}`,
        label: rows_[0].label,
        intervalMonths: interval,
        amountCents: last.amountCents,
        minAmountCents: min,
        maxAmountCents: max,
        amountVaries: varies,
        occurrences: cluster.length,
        firstSeen: cluster[0].date,
        lastSeen: last.date,
        nextExpected: addMonths(last.date, interval),
        confidence,
        category: rows_.find(r => r.category)?.category ?? null,
        subcategory: rows_.find(r => r.subcategory)?.subcategory ?? null,
      })
    }
  }

  return proposals.sort((a, b) => b.amountCents * b.confidence - a.amountCents * a.confidence)
}

/** What a confirmed proposal becomes in finance_obligations. */
export function proposalToObligation(p: RecurringProposal, kind: string): {
  title: string
  kind: string
  amount_cents: number
  due_date: ISODate
  recurrence_months: RecurrenceInterval
  notes: string
} {
  return {
    title: p.label,
    kind,
    amount_cents: p.amountCents,
    due_date: p.nextExpected,
    recurrence_months: p.intervalMonths,
    notes: p.amountVaries
      ? `Automatisch herkend uit ${p.occurrences} afschrijvingen. Het bedrag wisselt tussen €${eur(p.minAmountCents)} en €${eur(p.maxAmountCents)}.`
      : `Automatisch herkend uit ${p.occurrences} afschrijvingen van steeds €${eur(p.amountCents)}.`,
  }
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
}
