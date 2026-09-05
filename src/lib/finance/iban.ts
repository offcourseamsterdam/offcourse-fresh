/**
 * IBAN sanity for the pay path. A supplier IBAN reaches Revolut's counterparty
 * API exactly once (pay/route.ts caches the counterparty id afterwards), so a
 * typo'd or Gemini-misread IBAN would otherwise create a payee we then reuse
 * for every later invoice from that skipper. The ISO 13616 mod-97 checksum
 * catches any single-digit slip and most transpositions — cheap, offline, and
 * the same check the bank itself runs before accepting a transfer.
 *
 * Pure. Never touches the network or a database.
 */

/** Strips whitespace (people paste "NL91 ABNA 0417 1643 00") and upper-cases. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/

/**
 * True when the IBAN has a plausible shape AND its mod-97 checksum is 1.
 * Letters map to 10..35 (A=10) per ISO 13616; the remainder is accumulated
 * digit by digit so a 34-character IBAN never overflows a JS number.
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw)
  if (!IBAN_SHAPE.test(iban)) return false

  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const digits = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of digits) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97
  }
  return remainder === 1
}
