import { Resend } from 'resend'
import { postSlackText } from '@/lib/slack/send-notification'

/**
 * A CRITICAL alert that a human must see promptly — a paid-but-unrecorded booking,
 * a webhook that couldn't complete a booking, a chargeback.
 *
 * Why this exists: Slack was the ONLY alerting channel, and postSlackText silently
 * no-ops when SLACK_WEBHOOK_URL is unset/revoked/rate-limited. For a solo-operator
 * money business, "the alert didn't arrive" turns a recoverable incident into a
 * lost booking. This fans the same alert out to Slack AND email so one dead channel
 * can't swallow it. Both legs are best-effort and never throw — alerting must never
 * break or mask the business action it observes.
 */
export async function sendCriticalAlert(text: string, opts?: { subject?: string }): Promise<void> {
  await Promise.allSettled([
    postSlackText(text),
    sendAlertEmail(opts?.subject ?? 'Off Course — critical alert', text),
  ])
}

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

async function sendAlertEmail(subject: string, body: string): Promise<void> {
  const recipient = process.env.ALERT_EMAIL_RECIPIENT
  // No recipient or no Resend key → email leg is simply unavailable (Slack still tried).
  if (!recipient || !process.env.RESEND_API_KEY) return
  try {
    await getResend().emails.send({
      from: 'Off Course Alerts <cruise@offcourseamsterdam.com>',
      to: recipient,
      subject,
      // Strip Slack bold/code markup for a clean plaintext email. NOT underscores —
      // they appear in IDs (pi_xxx, avail PKs) and stripping them mangles the alert.
      text: body.replace(/[*`]/g, ''),
    })
  } catch (err) {
    console.error('[critical-alert] email send failed (ignored):', err)
  }
}
