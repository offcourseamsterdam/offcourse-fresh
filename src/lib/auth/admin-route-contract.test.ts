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
 */
function findHandlers(src: string): { method: string; guarded: boolean }[] {
  const marks: { method: string; index: number }[] = []
  for (const method of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) marks.push({ method, index: m.index })
  }
  marks.sort((a, b) => a.index - b.index)
  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length
    const body = src.slice(mark.index, end)
    return { method: mark.method, guarded: /requireAdmin\s*\(/.test(body) }
  })
}

const adminFiles = walk(ADMIN_DIR)

describe('admin route auth contract', () => {
  it('discovers the expected number of admin route files', () => {
    // Snapshot so any change in route count (addition OR deletion) requires
    // deliberate acknowledgement — update via `npx vitest run --update-snapshots`.
    // Count at time of writing: 68. Update this when adding/removing admin routes.
    expect(adminFiles.length).toMatchInlineSnapshot(`64`)
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
