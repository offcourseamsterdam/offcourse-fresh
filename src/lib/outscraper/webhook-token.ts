import { createHmac } from 'crypto'

/**
 * Deterministic shared secret appended to the Outscraper webhook callback URL
 * (`?token=…`), derived from the API key.
 *
 * Why not rely on Outscraper's X-Hub-Signature-256 HMAC: their request signing is
 * applied to dashboard-configured integration webhooks but is NOT reliably present
 * on the per-request `webhook` parameter we pass. A URL token we generate ourselves
 * works regardless — only someone holding the API key can produce it.
 */
export function outscraperWebhookToken(apiKey: string): string {
  return createHmac('sha256', apiKey).update('outscraper-webhook-v1').digest('hex')
}
