/**
 * WhatsApp sending via the Twilio REST API — raw fetch, same posture as
 * src/lib/sms/send-sms.ts (this file is deliberately its sibling, not a
 * shared abstraction: SMS and WhatsApp have different env vars, a `whatsapp:`
 * address prefix, and WhatsApp has the 24h-window failure mode SMS doesn't).
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (shared with SMS),
 *      TWILIO_WHATSAPP_NUMBER (E.164, WITHOUT the whatsapp: prefix — this
 *      file adds it, so the env var reads the same as any other phone number).
 */

/** Thrown when Twilio rejects a send because it's outside the 24h customer
 * service window (error 63016) — the caller can catch this specifically to
 * show "they need to message you again, or send a template" instead of a
 * generic failure. See docs/features/whatsapp-twilio-integration.md. */
export class WhatsappWindowClosedError extends Error {
  constructor() {
    super('Outside the 24-hour WhatsApp session window — the customer needs to message first, or this needs an approved template.')
    this.name = 'WhatsappWindowClosedError'
  }
}

function toWhatsappAddress(e164: string): string {
  return e164.startsWith('whatsapp:') ? e164 : `whatsapp:${e164}`
}

export interface SendWhatsappResult {
  id: string
}

/**
 * Send a free-form WhatsApp message. `to` is a plain E.164 number (the
 * `whatsapp:` prefix is added here, not by the caller) — same convention as
 * every other phone field in this codebase (contacts.phone_e164, etc).
 */
export async function sendWhatsappMessage(params: { to: string; body: string }): Promise<SendWhatsappResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_NUMBER
  if (!sid || !token || !from) {
    throw new Error('WhatsApp is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER)')
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: toWhatsappAddress(params.to),
      From: toWhatsappAddress(from),
      Body: params.body,
    }),
  })

  if (!res.ok) {
    const rawBody = await res.text().catch(() => '')
    const detail = (() => {
      try {
        return JSON.parse(rawBody) as { code?: number; message?: string }
      } catch {
        return null
      }
    })()
    if (detail?.code === 63016) throw new WhatsappWindowClosedError()
    throw new Error(`Twilio ${res.status}: ${(detail?.message ?? rawBody).slice(0, 300)}`)
  }

  const json = (await res.json()) as { sid: string }
  return { id: json.sid }
}
