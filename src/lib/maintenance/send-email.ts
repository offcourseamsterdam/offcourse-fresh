import { Resend } from 'resend'

/**
 * Sends the maintenance/technician quote-request email. The body is already
 * drafted by the Ghost (payload.email_body) and approved by a human; this just
 * dispatches it with the same Resend SDK + from-address used by the catering /
 * booking confirmation emails.
 *
 * Returns true when it actually dispatched. Returns false ONLY when
 * RESEND_API_KEY is absent (dev / CI) — the caller treats that as "not sent".
 * THROWS on a real Resend API failure (the SDK returns { error } rather than
 * throwing), so the caller can release its claim and report it instead of
 * silently marking the proposal sent.
 */

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

export interface MaintenanceEmail {
  recipient: string
  subject: string
  body: string
}

export async function sendMaintenanceEmail({ recipient, subject, body }: MaintenanceEmail): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false
  const { error } = await getResend().emails.send({
    from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
    to: [recipient],
    subject,
    text: body,
  })
  // Resend reports API-level failures (unverified domain, bad recipient, rate
  // limit) in `error` instead of throwing — surface it so the send isn't a
  // silent no-op recorded as success.
  if (error) throw new Error(error.message ?? 'Resend send failed')
  return true
}
