import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every place that SUMS partner commission from `bookings` must skip cancelled
 * bookings — a cruise that never sailed earns the partner nothing. Found 2026-09:
 * the admin settlement summary counted a fully refunded Things To Do booking
 * (€80) in Q3. The partner-facing /api/partner/* routes already filtered; these
 * four didn't. A new aggregate over commission belongs in this list.
 */
const COMMISSION_AGGREGATES = [
  'src/app/api/admin/partners/[id]/settlement-summary/route.ts',
  'src/app/api/admin/finance/partners-summary/route.ts',
  'src/app/api/admin/partners/route.ts',
  'src/app/partners/[token]/page.tsx',
]

describe('partner commission aggregates skip cancelled bookings', () => {
  for (const file of COMMISSION_AGGREGATES) {
    it(file, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      const bookingQueries = src.split(".from('bookings')").slice(1)
      expect(bookingQueries.length).toBeGreaterThan(0)
      for (const query of bookingQueries) {
        // Only inspect the chained builder, up to the next statement/query
        const chain = query.split(/\n\s*(?:supabase|const |await |\]\))/)[0]
        expect(chain).toContain(".eq('status', 'confirmed')")
      }
    })
  }
})
