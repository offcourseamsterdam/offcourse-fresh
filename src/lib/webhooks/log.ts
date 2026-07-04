import type { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Durable audit/replay breadcrumb for inbound provider webhooks (Stripe, Outscraper).
 *
 * The webhook_logs table existed in the schema but nothing wrote to it, so when a
 * booking went missing you couldn't answer "did the provider deliver the event? was
 * the signature valid? what was the raw payload?" from our own DB — you had to dig in
 * the Stripe dashboard. This writes that record.
 *
 * Best-effort: wrapped so a logging failure can NEVER break or delay the actual
 * webhook handling. (Idempotency-by-event-id — refusing to re-process a redelivered
 * event — is a separate concern that needs a UNIQUE index on provider_event_id; this
 * function only records, it does not dedupe.)
 */
export async function logWebhookEvent(
  supabase: AdminClient,
  params: {
    source: string
    providerEventId: string | null
    signatureValid: boolean
    payload: unknown
    processed?: boolean
    error?: string | null
  },
): Promise<void> {
  try {
    await supabase.from('webhook_logs').insert({
      source: params.source,
      provider_event_id: params.providerEventId,
      signature_valid: params.signatureValid,
      payload: params.payload as Json,
      processed: params.processed ?? false,
      error: params.error ?? null,
      processed_at: params.processed ? new Date().toISOString() : null,
    })
  } catch (err) {
    console.error('[webhook-log] insert failed (ignored):', err)
  }
}
