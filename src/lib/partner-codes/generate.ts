/**
 * Generate a short, human-typable partner code.
 *
 * 8 chars drawn from A–Z 0–9 minus lookalikes (0/O, 1/I, 2/Z, 5/S, 8/B).
 * Rendered with a dash in the middle for readability: e.g. "WBKA-2X9F".
 */
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY3469'

export function generatePartnerCode(): string {
  let raw = ''
  for (let i = 0; i < 8; i++) {
    raw += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/**
 * Normalize a user-typed code for lookup:
 *   - uppercase
 *   - strip spaces and dashes
 *   - re-insert the canonical dash after the 4th char
 *
 * "wbka 2x9f" → "WBKA-2X9F"
 * "WBKA2X9F"  → "WBKA-2X9F"
 * ""          → ""
 */
export function normalizePartnerCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '')
  if (cleaned.length !== 8) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

/** Months-from-now → ISO string for expires_at */
export function threeMonthsFromNow(from: Date = new Date()): string {
  const d = new Date(from)
  d.setMonth(d.getMonth() + 3)
  return d.toISOString()
}
