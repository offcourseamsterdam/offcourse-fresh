import { NextRequest, after } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { stockCountUrl } from '@/lib/stock/stock-token'
import { draftStockReorders } from '@/lib/ghost/stock-drafter'

/**
 * /api/admin/stock
 *   GET    — the stock catalog (every item + current counts) + the QR link.
 *   POST   — create a stock item.
 *   PATCH  — update an item (rename, thresholds, supplier, or a new count).
 *            An admin count change re-runs the reorder drafter (off the response).
 *   DELETE — remove an item (?id=).
 */

const CATEGORIES = ['drinks', 'snacks', 'supplies', 'other'] as const

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('stock_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return apiError(error.message)
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    return apiOk({ items: data ?? [], qrUrl: stockCountUrl(baseUrl) })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load stock')
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return apiError('name is required', 400)
    const category = CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])
      ? (body.category as string)
      : 'other'

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('stock_items')
      .insert({
        name,
        category,
        unit: typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim() : 'tray',
        pack_size: Number.isFinite(body.pack_size) && (body.pack_size as number) > 0 ? Math.trunc(body.pack_size as number) : null,
        pack_unit: typeof body.pack_unit === 'string' ? body.pack_unit.trim() || null : null,
        location: typeof body.location === 'string' ? body.location.trim() || null : null,
        current_count: Number.isFinite(body.current_count) ? Math.max(0, Math.trunc(body.current_count as number)) : 0,
        reorder_threshold: Number.isFinite(body.reorder_threshold) ? Math.max(0, Math.trunc(body.reorder_threshold as number)) : 0,
        reorder_qty: Number.isFinite(body.reorder_qty) ? Math.max(0, Math.trunc(body.reorder_qty as number)) : 0,
        supplier_name: typeof body.supplier_name === 'string' ? body.supplier_name.trim() || null : null,
        supplier_email: typeof body.supplier_email === 'string' ? body.supplier_email.trim() || null : null,
        sort_order: Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order as number) : 0,
      })
      .select('id')
      .single()
    if (error) return apiError(error.message)
    return apiOk({ id: data?.id })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to create item')
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return apiError('id is required', 400)

    const patch: Record<string, unknown> = {}
    let countChanged = false
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) patch.category = body.category
    if (typeof body.unit === 'string' && body.unit.trim()) patch.unit = body.unit.trim()
    if ('pack_size' in body) patch.pack_size = Number.isFinite(body.pack_size) && (body.pack_size as number) > 0 ? Math.trunc(body.pack_size as number) : null
    if ('pack_unit' in body) patch.pack_unit = typeof body.pack_unit === 'string' ? body.pack_unit.trim() || null : null
    if ('location' in body) patch.location = typeof body.location === 'string' ? body.location.trim() || null : null
    if ('supplier_name' in body) patch.supplier_name = typeof body.supplier_name === 'string' ? body.supplier_name.trim() || null : null
    if ('supplier_email' in body) patch.supplier_email = typeof body.supplier_email === 'string' ? body.supplier_email.trim() || null : null
    if (Number.isFinite(body.reorder_threshold)) patch.reorder_threshold = Math.max(0, Math.trunc(body.reorder_threshold as number))
    if (Number.isFinite(body.reorder_qty)) patch.reorder_qty = Math.max(0, Math.trunc(body.reorder_qty as number))
    if (Number.isFinite(body.sort_order)) patch.sort_order = Math.trunc(body.sort_order as number)
    if (typeof body.active === 'boolean') patch.active = body.active
    if (Number.isFinite(body.current_count)) {
      patch.current_count = Math.max(0, Math.trunc(body.current_count as number))
      patch.last_counted_at = new Date().toISOString()
      patch.counted_via = 'admin'
      countChanged = true
    }
    if (!Object.keys(patch).length) return apiError('Nothing to update', 400)

    const supabase = createAdminClient()
    const { error } = await supabase.from('stock_items').update(patch).eq('id', id)
    if (error) return apiError(error.message)

    // A new count may have pushed something below threshold — let the Ghost draft.
    if (countChanged) after(() => draftStockReorders())
    return apiOk({ id })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to update item')
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return apiError('id is required', 400)
    const supabase = createAdminClient()
    const { error } = await supabase.from('stock_items').delete().eq('id', id)
    if (error) return apiError(error.message)
    return apiOk({ id })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to delete item')
  }
}
