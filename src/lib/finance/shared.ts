// Shared parsing primitives for the finance/kasboek pipeline. Consolidated
// 2026-07 — parseCsvRows was duplicated character-for-character across
// revolut-statement.ts and fareharbor-payout-csv.ts (with a weaker, line-based
// variant in clickandboat-csv.ts that broke on a quoted field containing an
// embedded newline, since that file split on newlines BEFORE parsing quotes).
// toCents existed 7× with 4 incompatible cleaning rules — feeding a
// €-prefixed value to the variant that only stripped commas silently
// returned 0 instead of erroring. splitVat lived in withlocals-summary.ts
// despite being the module's most-shared primitive (15 importers).

/**
 * Splits a full CSV file into rows of fields, honoring double-quoted fields
 * (with "" as an escaped quote) that may contain commas or embedded newlines.
 * Processes the whole text as one character stream — unlike splitting on
 * newlines first, a newline inside a quoted field is handled correctly.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      // skip — \n (or end of file) terminates the row
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  // last row (file may or may not end with a trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(r => r.some(f => f.trim().length > 0))
}

/**
 * Parses a currency-formatted string (handles a leading €, thousands commas,
 * and surrounding whitespace — a strict superset of every per-source variant
 * this replaced) to integer cents. Returns null when the value can't be
 * parsed as a number, rather than silently defaulting to 0 — a source whose
 * import can't tell "missing" from "genuinely zero" would otherwise mask bad
 * data. Callers that want the old zero-on-failure behavior use `toCents(v) ?? 0`.
 */
export function toCents(value: string | number | undefined | null): number | null {
  if (value == null) return null
  const cleaned = String(value).replace(/[€\s,]/g, '').trim()
  const n = parseFloat(cleaned)
  return Number.isNaN(n) ? null : Math.round(n * 100)
}

/**
 * Splits a gross (incl-VAT) amount into ex-VAT + VAT at the given rate.
 * Computed per booking (then summed) so rounding never drifts against the
 * stored gross.
 */
export function splitVat(inclCents: number, ratePercent: number): { exCents: number; vatCents: number } {
  const exCents = Math.round(inclCents / (1 + ratePercent / 100))
  return { exCents, vatCents: inclCents - exCents }
}
