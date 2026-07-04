import { CLAUDE_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractJson } from '@/lib/ghost/ops-drafters'

/**
 * The storage agent — shadow mode.
 *
 * After a stock count comes in (QR form or the admin grid), this scans for
 * items at/below their reorder threshold, groups them by supplier, and drafts
 * one supplier reorder email per supplier as a shadow `stock_reorder` proposal.
 * A human approves & sends it from the Ghost dashboard (same draft → approve →
 * send path as maintenance; a reorder email is correctable, never auto-sent).
 *
 * Same hard rules as the other drafters: status 'shadow', nothing is sent,
 * every AI call metered, skip-first (no low items → no call; a supplier already
 * drafted in the last few days → no call), all errors swallowed.
 */

/** Don't re-draft a supplier's reorder if one was drafted within this window. */
const DEDUPE_DAYS = 3

type StockItemRow = {
  id: string
  name: string
  unit: string
  pack_size: number | null
  pack_unit: string | null
  current_count: number
  reorder_threshold: number
  reorder_qty: number
  supplier_name: string | null
  supplier_email: string | null
}

/** Group key so the same supplier (or the no-supplier bucket) drafts once. */
function supplierKey(item: { supplier_email: string | null; supplier_name: string | null }): string {
  return item.supplier_email || item.supplier_name || '__none__'
}

export async function draftStockReorders(): Promise<{ drafted: number; skipped: number }> {
  try {
    const supabase = createAdminClient()

    const { data: items } = await supabase
      .from('stock_items')
      .select('id, name, unit, pack_size, pack_unit, current_count, reorder_threshold, reorder_qty, supplier_name, supplier_email')
      .eq('active', true)

    // Low = at/below threshold, and the item actually tracks reorders (threshold > 0).
    const low = ((items ?? []) as StockItemRow[]).filter(
      i => i.reorder_threshold > 0 && i.current_count <= i.reorder_threshold,
    )
    // Skip-first: nothing low → no AI spend at all.
    if (!low.length) return { drafted: 0, skipped: 0 }

    // Group the low items by supplier.
    const groups = new Map<string, StockItemRow[]>()
    for (const item of low) {
      const key = supplierKey(item)
      const arr = groups.get(key) ?? []
      arr.push(item)
      groups.set(key, arr)
    }

    // Dedupe: a supplier already drafted in the last DEDUPE_DAYS is skipped
    // (avoids re-drafting the same reorder every time someone recounts before
    // the stock has arrived). Rejected/expired drafts don't count as covered.
    const since = new Date(Date.now() - DEDUPE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: recent } = await supabase
      .from('agent_proposals')
      .select('payload, status, created_at')
      .eq('kind', 'stock_reorder')
      .gte('created_at', since)
    const covered = new Set(
      (recent ?? [])
        .filter(r => r.status !== 'rejected' && r.status !== 'expired')
        .map(r => (r.payload as { supplier_key?: string } | null)?.supplier_key)
        .filter((k): k is string => !!k),
    )

    let drafted = 0
    let skipped = 0

    for (const [key, groupItems] of groups) {
      if (covered.has(key)) {
        skipped++
        continue
      }

      const supplierName = groupItems[0].supplier_name
      // Per-item supplier_email wins; otherwise fall back to the global env.
      const recipient = groupItems[0].supplier_email || process.env.STOCK_EMAIL_RECIPIENT || null
      const urgent = groupItems.some(i => i.current_count === 0)

      const itemLines = groupItems
        .map(i => {
          const pack = i.pack_size && i.pack_unit ? ` (${i.pack_size} ${i.pack_unit} per ${i.unit})` : ''
          return `- ${i.name}: ${i.current_count} ${i.unit} left → reorder ${i.reorder_qty || '?'} ${i.unit}${pack}`
        })
        .join('\n')

      const response = await meteredMessage('ghost_stock_reorder', {
        model: CLAUDE_MODEL,
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: `You are the shadow storage assistant for Off Course Amsterdam (electric canal boats). The stock items below are at or under their reorder level and need restocking from ${supplierName || 'our supplier'}. This is a SHADOW proposal — nothing is sent; a human reviews it.

Draft a short, friendly reorder email IN DUTCH: greet the supplier, list what we'd like to reorder using the reorder quantities, keep it human and to the point (no corporate fluff), and sign off as "Off Course Amsterdam".

ITEMS LOW:
${itemLines}

Return JSON only:
{"email_subject": "<subject>", "email_body": "<the full email body>", "reasoning": "<1 sentence: what's low and why now>"}`,
          },
        ],
      })

      const parsed = extractJson(firstText(response))
      if (!parsed || typeof parsed.email_body !== 'string' || !parsed.email_body.trim()) {
        skipped++
        continue
      }

      const { error } = await supabase.from('agent_proposals').insert({
        kind: 'stock_reorder',
        status: 'shadow',
        model: CLAUDE_MODEL,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
        payload: {
          supplier_key: key,
          supplier_name: supplierName,
          supplier_email: recipient,
          recipient,
          urgency: urgent ? 'urgent' : 'routine',
          item_ids: groupItems.map(i => i.id),
          items: groupItems.map(i => ({
            name: i.name,
            quantity: i.reorder_qty,
            unit: i.unit,
            pack_size: i.pack_size,
            pack_unit: i.pack_unit,
          })),
          email_subject: typeof parsed.email_subject === 'string' ? parsed.email_subject : 'Stock reorder — Off Course Amsterdam',
          email_body: parsed.email_body,
        },
      })
      if (error) {
        skipped++
        continue
      }
      drafted++
    }

    return { drafted, skipped }
  } catch (err) {
    console.error('[ghost/stock_reorder] failed:', err instanceof Error ? err.message : err)
    return { drafted: 0, skipped: 0 }
  }
}
