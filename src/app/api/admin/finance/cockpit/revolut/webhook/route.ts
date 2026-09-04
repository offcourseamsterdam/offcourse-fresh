import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { encryptSecret } from '@/lib/revolut/crypto'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'

export const dynamic = 'force-dynamic'

const RECEIVER_PATH = '/api/webhooks/revolut'

function receiverUrl(): string | null {
  const site = process.env.REVOLUT_WEBHOOK_URL ?? process.env.NEXT_PUBLIC_SITE_URL
  if (!site) return null
  return site.startsWith('http') && !site.includes('/api/') ? `${site.replace(/\/$/, '')}${RECEIVER_PATH}` : site
}

/** POST: register our receiver with Revolut (webhooks v2) and store the signing secret encrypted. */
export async function POST(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const row = await loadConnection(supabase)
    if (!isConnected(row)) return apiError('Revolut is niet gekoppeld', 400)
    const url = receiverUrl()
    if (!url || !url.startsWith('https://')) return apiError('Webhook-URL moet https zijn (NEXT_PUBLIC_SITE_URL of REVOLUT_WEBHOOK_URL)', 400)
    const client = await createRevolutClient(supabase)
    if (row.webhook_id) {
      await client.deleteWebhook(row.webhook_id).catch(() => undefined)
    }
    const hook = await client.createWebhook(url, ['TransactionCreated', 'TransactionStateChanged'])
    if (!hook.signing_secret) return apiError('Revolut gaf geen signing secret terug', 502)
    const { error } = await supabase
      .from('revolut_connection')
      .update({ webhook_id: hook.id, webhook_url: hook.url, webhook_secret_enc: encryptSecret(hook.signing_secret), updated_at: new Date().toISOString() })
      .eq('id', 'default')
    if (error) return apiError(error.message, 500)
    await logFinanceEvent(supabase, { event_type: 'revolut_webhook_registered', actor: 'user', entity_type: 'revolut', entity_id: null, payload: { webhook_id: hook.id, url: hook.url } })
    return apiOk({ id: hook.id, url: hook.url, events: hook.events })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}

/** DELETE: remove the webhook at Revolut and forget the secret. The 15-minute sync keeps working. */
export async function DELETE(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const row = await loadConnection(supabase)
    if (!row.webhook_id) return apiOk({ removed: false })
    if (isConnected(row)) {
      const client = await createRevolutClient(supabase)
      await client.deleteWebhook(row.webhook_id).catch(() => undefined)
    }
    const { error } = await supabase
      .from('revolut_connection')
      .update({ webhook_id: null, webhook_url: null, webhook_secret_enc: null, updated_at: new Date().toISOString() })
      .eq('id', 'default')
    if (error) return apiError(error.message, 500)
    await logFinanceEvent(supabase, { event_type: 'revolut_webhook_removed', actor: 'user', entity_type: 'revolut', entity_id: null, payload: { webhook_id: row.webhook_id } })
    return apiOk({ removed: true })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
