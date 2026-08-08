import { NextResponse, type NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { syncGYGReviews, GYG_PRODUCT_URLS } from '@/lib/getyourguide/sync'

/**
 * GET /api/cron/getyourguide-reviews
 *
 * Scheduled weekly (Monday 08:15 Amsterdam time — see vercel.json).
 * Fetches GYG reviews via JSON-LD from every known product's activity page
 * (GYG_PRODUCT_URLS) — not just one. Off Course has multiple GYG listings
 * (confirmed via real "new review" notification emails naming different
 * products, 2026-08-07/08); checking only one page here would silently miss
 * reviews for every other listing, forever, since this is the only path that
 * covers a product with no recent review to reactively trigger off of.
 *
 * One product's page being Cloudflare-blocked doesn't stop the others —
 * partial results still get reported. If any is blocked, the admin
 * computer-use import is the fallback for that product specifically.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    let imported = 0
    let skipped = 0
    const blockedProducts: string[] = []

    for (const [productName, url] of Object.entries(GYG_PRODUCT_URLS)) {
      const result = await syncGYGReviews(url)
      if (result.blocked) {
        console.warn(`[cron/getyourguide-reviews] blocked for "${productName}" — manual computer-use import needed`)
        blockedProducts.push(productName)
        continue
      }
      imported += result.imported
      skipped += result.skipped
    }

    return NextResponse.json({ ok: true, imported, skipped, blockedProducts })
  } catch (err) {
    await alertCronFailure('getyourguide-reviews', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
