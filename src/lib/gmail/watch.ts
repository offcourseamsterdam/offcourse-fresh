// Registers (and renews) a Gmail "watch" — Google's push-notification
// subscription. Same no-SDK REST philosophy as client.ts. A watch expires
// after 7 days (Google's hard limit), so this must be re-called periodically
// — see cron/gmail-watch-renew. Re-calling watch() while one is still active
// simply extends it; Google's API is idempotent here, no need to detect
// "already watching" first.
import { getGmailAccessToken } from './auth'

function gmailUser(): string {
  const user = process.env.GMAIL_USER
  if (!user) throw new Error('GMAIL_USER not configured')
  return user
}

export interface GmailWatchResult {
  /** The mailbox's history ID at watch-registration time — not currently used (the push webhook re-syncs via the existing full inbox sync instead of history.list), kept for future use if history-diffing is ever added. */
  historyId: string
  /** Unix ms timestamp string when this watch expires — always ~7 days out. */
  expiration: string
}

/**
 * Tells Gmail to publish a Pub/Sub notification to GMAIL_PUBSUB_TOPIC every
 * time the INBOX label changes (new mail, among other things) — see
 * https://developers.google.com/gmail/api/guides/push. Requires the Pub/Sub
 * topic to already exist with gmail-api-push@system.gserviceaccount.com
 * granted Pub/Sub Publisher on it (a one-time manual Google Cloud Console
 * step — see docs/features/gmail-push-notifications.md).
 */
export async function registerGmailWatch(): Promise<GmailWatchResult> {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC
  if (!topicName) throw new Error('GMAIL_PUBSUB_TOPIC not configured')

  const token = await getGmailAccessToken()
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(gmailUser())}/watch`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicName, labelIds: ['INBOX'] }),
    },
  )
  if (!res.ok) {
    throw new Error(`Gmail watch registration failed (${res.status}): ${await res.text()}`)
  }
  return res.json() as Promise<GmailWatchResult>
}
