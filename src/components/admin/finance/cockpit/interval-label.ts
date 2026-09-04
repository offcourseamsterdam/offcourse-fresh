/**
 * Dutch label for a recurring-charge interval (1/3/6/12 months). Pulled out of
 * ObligationsManagerModal so the mapping can be unit-tested without rendering
 * anything.
 */
import type { RecurrenceInterval } from '@/lib/finance/cockpit/derived/recurring'

const INTERVAL_LABELS: Record<RecurrenceInterval, string> = {
  1: 'per maand',
  3: 'per kwartaal',
  6: 'per halfjaar',
  12: 'per jaar',
}

/** 1 → "per maand", 3 → "per kwartaal", 6 → "per halfjaar", 12 → "per jaar". */
export function intervalLabelNL(months: RecurrenceInterval): string {
  return INTERVAL_LABELS[months] ?? `elke ${months} maanden`
}

/** Same, but tolerant of a raw `recurrence_months` column (any int, or null/undefined for "eenmalig"). */
export function recurrenceLabelNL(months: number | null | undefined): string | null {
  if (!months) return null
  if (months === 1 || months === 3 || months === 6 || months === 12) return intervalLabelNL(months)
  return `elke ${months} maanden`
}
