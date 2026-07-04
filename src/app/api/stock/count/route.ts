import { NextRequest, after } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidStockToken } from '@/lib/stock/stock-token'
import { draftStockReorders } from '@/lib/ghost/stock-drafter'

/**
 * PUBLIC, token-gated. The storage-room QR form submits counts here.
 * No admin session — the HMAC token IS the auth (same posture as the
 * extras-upsell page). A bad token is a 403; nothing else is exposed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string
      counts?: Array<{ id?: string; count?: number }>
    }
    if (!isValidStockToken(body.token ?? '')) return apiError('Invalid or expired link', 403)

    const counts = Array.isArray(body.counts) ? body.counts : []
    // Cap the work: a storage room has well under this many items. A token-holder
    // can't turn one request into thousands of DB round-trips.
    if (counts.length > 200) return apiError('Too many items', 400)
    // Dedupe by id (last value wins) so a repeated id is one write.
    const byId = new Map<string, number>()
    for (const c of counts) {
      if (typeof c.id === 'string' && Number.isFinite(c.count)) {
        byId.set(c.id, Math.max(0, Math.trunc(c.count as number)))
      }
    }
    if (!byId.size) return apiError('No counts submitted', 400)

    const supabase = createAdminClient()
    const now = new Date().toISOString()
    // Small list — sequential updates are fine. Only active items can be counted
    // (mirrors the QR page query + the drafter, which both filter active = true).
    for (const [id, count] of byId) {
      await supabase
        .from('stock_items')
        .update({ current_count: count, last_counted_at: now, counted_via: 'qr' })
        .eq('id', id)
        .eq('active', true)
    }

    // Off the response path so the phone gets its 200 fast.
    after(() => draftStockReorders())
    return apiOk({ updated: byId.size })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to save counts')
  }
}
