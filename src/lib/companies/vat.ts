/**
 * Clean and parse an EU VAT number into country code + clean number.
 * e.g. "NL867981374B01", "nl 8679.81.374.B01", "867981374B01" (assumes NL if 8-9 digits + B01).
 */
export function parseVatInput(input: string): { countryCode: string; vatNumber: string } | null {
  if (!input || input.length > 50) return null
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return null

  // Check if first 2 characters are ISO country code (EU member states)
  const countryCode = cleaned.substring(0, 2)
  const EU_COUNTRIES = [
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
    'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
    'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI'
  ]

  if (EU_COUNTRIES.includes(countryCode)) {
    const vatNumber = cleaned.substring(2)
    if (vatNumber.length >= 2) {
      return { countryCode, vatNumber }
    }
  }

  // If no prefix, but fits Dutch format (9 digits + B + 2 digits, e.g. 123456789B01), default to NL
  if (/^\d{9}B\d{2}$/.test(cleaned)) {
    return { countryCode: 'NL', vatNumber: cleaned }
  }

  return null
}
