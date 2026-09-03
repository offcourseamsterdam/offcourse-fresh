import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * AUTH CONTRACT GUARDRAIL
 * =======================
 * This test fails the build if either of these ever happens again:
 *
 *   (a) an /api/admin/** route handler is missing its requireAdmin() lock
 *       → the original critical hole (anyone could cancel bookings, refund
 *         cards, mint promo codes). A new admin route added without a guard
 *         is caught here BEFORE it reaches production.
 *
 *   (b) a customer-facing / checkout route accidentally GETS a lock
 *       → the near-miss that almost broke "add extras" during booking.
 *
 * It reads the route source files directly (no server needed), so it runs in
 * CI on every push. If it fails, the message tells you exactly which route and
 * what to do.
 */

const ADMIN_DIR = join(process.cwd(), 'src/app/api/admin')
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * Routes under /api/admin/** that are INTENTIONALLY public (no requireAdmin),
 * keyed by posix path relative to src/app/api/admin → the methods that are public.
 *
 * Adding an entry here is a deliberate security decision: you are asserting the
 * route exposes only public data, or is protected another way (CSRF state cookie,
 * or it's re-exported to a public path). The test enforces BOTH directions:
 * everything NOT listed must be guarded; everything listed must NOT be guarded.
 */
const PUBLIC_EXCEPTIONS: Record<string, string[]> = {
  // booking-flow/book/route.ts was previously excepted here. It now has
  // requireAdmin() for internal booking sources (partner_invoice, stripe_recovery,
  // platform sources) while website=customer-checkout remains open. The handler
  // body contains the guard, so the contract test correctly sees it as guarded.
  //
  // The public add-on menu the checkout's ExtrasStep reads (public product data).
  // Its PATCH (admin toggle) stays guarded.
  'cruise-listings/[id]/extras/route.ts': ['GET'],
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/**
 * Returns each HTTP handler DEFINED AS A FUNCTION BODY in the file, with whether
 * its body references requireAdmin(). Pure re-exports (`export { POST } from ...`)
 * have no body and are intentionally ignored — guard-ness lives in their target.
 *
 * Also recognizes the `createSummaryRoute()` factory (src/lib/api/create-summary-route.ts):
 * finance `.../summary/route.ts` handlers are `export const { GET } = createSummaryRoute({...})`
 * rather than `export function GET`, so there's no per-file body to grep for
 * requireAdmin() — the factory itself calls requireAdmin() unconditionally on every
 * invocation (see create-summary-route.ts and its own auth-denied-passthrough test),
 * so any method destructured from a createSummaryRoute(...) call is treated as guarded.
 *
 * Also recognizes requireAdminOrFinanceShare() (src/lib/auth/finance-share.ts): every
 * /api/admin/finance/** route accepts this as an alternative to a bare requireAdmin()
 * call, so an accountant holding a temporary finance_share_links token can view/upload
 * without a real admin session. It still denies everyone else exactly like requireAdmin()
 * — see finance-share.test.ts. Routes that manage the tokens themselves
 * (share-links/route.ts, share-links/[id]/route.ts) deliberately keep bare requireAdmin(),
 * since the token must never be able to mint or revoke tokens.
 */
function findHandlers(src: string): { method: string; guarded: boolean }[] {
  const marks: { method: string; index: number }[] = []
  for (const method of HTTP_METHODS) {
    // Matches both `export async function METHOD(` and the withRoute()-wrapped
    // form `export const METHOD = withRoute(async (...`.
    const re = new RegExp(`export\\s+(?:async\\s+function\\s+${method}\\b|const\\s+${method}\\s*=)`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) marks.push({ method, index: m.index })
  }
  marks.sort((a, b) => a.index - b.index)
  const handlers = marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length
    const body = src.slice(mark.index, end)
    return { method: mark.method, guarded: /requireAdmin(?:OrFinanceShare)?\s*\(/.test(body) }
  })

  const factoryRe = /export\s+const\s+\{([^}]+)\}\s*=\s*createSummaryRoute\s*\(/g
  let fm: RegExpExecArray | null
  while ((fm = factoryRe.exec(src))) {
    for (const name of fm[1].split(',').map(s => s.trim().split(':')[0].trim())) {
      if ((HTTP_METHODS as readonly string[]).includes(name)) {
        handlers.push({ method: name, guarded: true })
      }
    }
  }

  return handlers
}

const adminFiles = walk(ADMIN_DIR)

describe('admin route auth contract', () => {
  it('discovers the expected number of admin route files', () => {
    // Snapshot so any change in route count (addition OR deletion) requires
    // deliberate acknowledgement — update via `npx vitest run --update-snapshots`.
    // 78 = 77 + /api/admin/boats/[id]/sync-capacity (pulls a boat's real max
    // guest capacity from FareHarbor instead of a manually-typed number).
    // 79 = 78 + /api/admin/finance/vat-stripe-summary (BTW + Stripe payout
    // reconciliation, bucketed by quarter, for the Finance tab).
    // 81 = 79 + /api/admin/finance/viator/upload + /api/admin/finance/viator/summary
    // (parse & store Viator payment advice .xlsx attachments, quarterly totals).
    // 86 = 81 + /api/admin/finance/attachments/[source]/[id] (shared signed-URL
    // redirect for stored source documents) + /api/admin/finance/viator/batches
    // (per-batch line-item detail) + /api/admin/finance/getyourguide/upload,
    // /summary, /payments (GetYourGuide payment-confirmation PDF ingestion).
    // 89 = 86 + /api/admin/finance/boatlocal/upload, /summary, /batches
    // (BoatLocal operator-invoice PDF ingestion, full VAT breakdown + lines).
    // 92 = 89 + /api/admin/finance/zettle/upsert, /summary, /months
    // (Zettle onboard POS: monthly card/cash figures read off the portal +
    // cash-count reconciliation — no file upload, entered per month).
    // 96 = 92 + /api/admin/finance/withlocals/upload, /payout, /summary,
    // /bookings (Withlocals marketplace revenue: combines the per-booking
    // invoice PDF with the monthly payout email; per-month revenue + 9%
    // output VAT + 21% deductible commission VAT, per-tour breakdown).
    // 97 = 96 + /api/admin/finance/btw-dashboard/summary (unified BTW view
    // across every source with a VAT split).
    // 100 = 97 + /api/admin/finance/clickandboat/upload, /summary, /bookings
    // (Click & Boat CSV-export ingestion; 9% owed over the NET amount —
    // Withlocals is gross, this and every source below is net).
    // 103 = 100 + /api/admin/finance/getmyboat/payout, /summary, /bookings
    // (Getmyboat payout-email ingestion, no attachment — same shape as
    // Withlocals' payout side but exact-id matched, no fuzzy prefix needed).
    // Viator and GetYourGuide were briefly excluded from the BTW dashboard's
    // VAT split (an "international companies, no 9%" assumption) but that
    // was reversed — both are wired into btw-dashboard/summary/route.ts now,
    // no route-count change needed since no new routes were added for that.
    // 106 = 103 + /api/admin/finance/barqo/upsert, /summary, /bookings
    // (Barqo — only 2 known bookings, no recurring document at all, entered
    // by hand off the dashboard like Zettle; same production Stripe account
    // as everything else, not a separate integration).
    // 110 = 106 + /api/admin/finance/revolut/upload, /classify, /summary,
    // /transactions (Revolut payment-link sales — free-text descriptions mix
    // 9%/21% per transaction with no reliable auto-split, so every
    // transaction needs a human-confirmed classification via /classify
    // before it counts as VAT-owed anywhere).
    // 113 = 110 + /api/admin/finance/fareharbor/upload, /summary, /payouts
    // (FareHarbor's own payment processing — archief, closed period ended
    // early May 2026 when the site migrated to its native Stripe checkout;
    // FareHarbor already computes the 9%/21% VAT split per line, nothing to
    // derive or classify).
    // 114 = 113 + /api/admin/finance/fareharbor/set-bank-date (FareHarbor's
    // own reported payout date turned out unreliable for accounting purposes
    // — this confirms the REAL bank-arrival date per payout, separately).
    // 116 = 114 + /api/admin/finance/share-links + /share-links/[id] (issue
    // and revoke temporary accountant tokens for the Finance tab — migration
    // 107, src/lib/auth/finance-share.ts).
    // 118 = 116 + /api/admin/bookings/[id]/catering-email + /api/admin/bookings/[id]/review-sms
    // (manual send of post-cruise review & local recommendations SMS via Twilio).
    // 125 = 124 + /api/admin/finance/invoices (Dedicated open/paid B2B invoice dashboard).
    // Update this when adding/removing admin routes.
    expect(adminFiles.length).toMatchInlineSnapshot(`125`)
  })

  it('every admin handler is guarded with requireAdmin() unless explicitly public', () => {
    const unguarded: string[] = []
    for (const file of adminFiles) {
      const rel = relative(ADMIN_DIR, file).split(sep).join('/')
      const src = readFileSync(file, 'utf8')
      const exceptions = PUBLIC_EXCEPTIONS[rel] ?? []
      for (const h of findHandlers(src)) {
        if (exceptions.includes(h.method)) continue
        if (!h.guarded) unguarded.push(`${rel} → ${h.method}`)
      }
    }
    // If this fails: add `const denied = await requireAdmin(); if (denied) return denied`
    // to the listed handler(s), or (only if truly public) add them to PUBLIC_EXCEPTIONS.
    expect(unguarded).toEqual([])
  })

  it('every PUBLIC_EXCEPTIONS entry exists and is genuinely UNguarded', () => {
    const wronglyGuarded: string[] = []
    const missingHandler: string[] = []
    for (const [rel, methods] of Object.entries(PUBLIC_EXCEPTIONS)) {
      const file = join(ADMIN_DIR, ...rel.split('/'))
      const src = readFileSync(file, 'utf8') // throws if a listed path goes stale → good
      const handlers = findHandlers(src)
      for (const method of methods) {
        const h = handlers.find(x => x.method === method)
        if (!h) missingHandler.push(`${rel} → ${method}`)
        else if (h.guarded) wronglyGuarded.push(`${rel} → ${method}`)
      }
    }
    // wronglyGuarded failing = a public/checkout route got an admin lock (the near-miss).
    expect(missingHandler).toEqual([])
    expect(wronglyGuarded).toEqual([])
  })
})

describe('customer-facing booking routes are never admin-locked', () => {
  const PUBLIC_BOOKING_ROUTES = [
    'src/app/api/search/route.ts',
    'src/app/api/search/slots/route.ts',
    'src/app/api/booking-flow/quote/route.ts',
    'src/app/api/booking-flow/create-intent/route.ts',
  ]
  it('search + slots + quote + create-intent contain no requireAdmin', () => {
    const offenders: string[] = []
    for (const rel of PUBLIC_BOOKING_ROUTES) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      if (/requireAdmin/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
