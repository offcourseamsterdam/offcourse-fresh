/**
 * SMS sending via the Twilio REST API — no SDK, one fetch, same posture as
 * the Slack helpers: configuration-optional.
 *
 * Returns true when actually dispatched. Returns false ONLY when Twilio env
 * vars are absent (dev / not yet configured) — callers treat that as "channel
 * unavailable" and fall back to email. THROWS on a real Twilio API failure so
 * the caller can report it instead of silently recording a send.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164).
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !token || !from) return false

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Twilio ${res.status}: ${detail.slice(0, 300)}`)
  }
  return true
}
