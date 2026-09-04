import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/revolut/crypto'
import { parseRevolutWebhook, verifyRevolutWebhook, webhookDedupeKey, type TransactionStateChangedData } from '@/lib/revolut/webhook-signature'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { mapTransaction } from '@/lib/revolut/sync'
import { toCents } from '@/lib/revolut/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/revolut — Revolut Business webhooks v2.
 *
 * Trust model: verify the HMAC over the RAW body (never re-serialised) and the
 * 5-minute timestamp window; dedupe on (event, id, state, timestamp) because
 * Revolut may deliver twice and out of order; then RE-FETCH the transaction by
 * id and upsert it — the payload itself is never treated as the truth.
 * Always answers quickly. On processing errors we still return 200: the
 * 15-minute sync is the safety net, and a retry storm helps nobody.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signatureHeader = request.headers.get('revolut-signature')
  const timestampHeader = request.headers.get('revolut-request-timestamp')

  const supabase = createAdminClient()
  const row = await loadConnection(supabase)
  const secrets: string[] = []
  if (row.webhook_secret_enc) {
    try { secrets.push(decryptSecret(row.webhook_secret_enc)) } catch { /* fall through: no_secret */ }
  }

  const verdict = verifyRevolutWebhook({ rawBody, signatureHeader, timestampHeader, secrets })
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, error: verdict.reason }, { status: verdict.reason === 'no_secret' ? 503 : 401 })
  }

  const evt = parseRevolutWebhook(rawBody)
  if (!evt) return NextResponse.json({ ok: false, error: 'unparseable' }, { status: 400 })

  const txId = (evt.data as { id?: string }).id ?? null
  const dedupeKey = webhookDedupeKey(evt, timestampHeader as string)
  const { error: insErr } = await supabase
    .from('revolut_webhook_events')
    .insert({ dedupe_key: dedupeKey, event_type: evt.event, transaction_id: txId, payload: evt as never })
  if (insErr) {
    // 23505 = unique violation → we already have this delivery.
    if ((insErr as { code?: string }).code === '23505') return NextResponse.json({ ok: true, duplicate: true })
    console.error('[webhooks/revolut] insert failed', insErr.message)
    return NextResponse.json({ ok: true, recorded: false })
  }

  if (!txId || !isConnected(row) || !row.account_id) {
    return NextResponse.json({ ok: true, processed: false })
  }

  try {
    const client = await createRevolutClient(supabase)
    const tx = await client.getTransaction(txId)
    const now = new Date().toISOString()
    const mapped = mapTransaction(tx, row.account_id, now)
    if (mapped) {
      const { error: upErr } = await supabase.from('bank_transactions').upsert(mapped, { onConflict: 'revolut_id' })
      if (upErr) throw new Error(upErr.message)
      // A completed transaction carries the account balance after it: cheap, fresh snapshot.
      if (mapped.state === 'completed' && typeof mapped.balance_after_cents === 'number') {
        await supabase.from('revolut_balance_snapshots').insert({ taken_at: now, account_id: row.account_id, balance_cents: mapped.balance_after_cents, currency: mapped.currency, source: 'webhook' })
      }
    }
    await supabase.from('revolut_webhook_events').update({ processed_at: now }).eq('dedupe_key', dedupeKey)
    const change = evt.event === 'TransactionStateChanged' ? (evt.data as TransactionStateChangedData) : null
    return NextResponse.json({ ok: true, processed: Boolean(mapped), state: mapped?.state ?? null, change: change ? `${change.old_state}→${change.new_state}` : null, amountCents: mapped ? toCents(0) + mapped.amount_cents : null })
  } catch (err) {
    await supabase.from('revolut_webhook_events').update({ error: (err as Error).message }).eq('dedupe_key', dedupeKey)
    return NextResponse.json({ ok: true, processed: false, error: 'deferred_to_sync' })
  }
}
