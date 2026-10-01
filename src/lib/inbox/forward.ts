/**
 * Pure helpers for forwarding an inbox email thread to someone else (e.g.
 * finance@ or a partner). A forward is NOT a reply: it goes out as a fresh
 * email to a third party, carries the original message (text + attachments),
 * and never touches the customer's thread or status.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Trimmed, lowercased forward address, or null when it isn't a plausible single email. */
export function parseForwardTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return EMAIL_RE.test(v) && v.length <= 254 ? v : null
}

/** "Fwd: <subject>", without stacking a second prefix. */
export function forwardSubject(subject: string | null | undefined): string {
  const s = (subject ?? '').trim()
  return /^fwd?:/i.test(s) ? s : `Fwd: ${s}`.trim()
}

/** Optional note on top, then the original message in the familiar Gmail "Forwarded message" block. */
export function buildForwardBody(params: {
  note: string | null
  fromName: string | null
  fromEmail: string | null
  sentAt: string | null
  subject: string | null
  originalBody: string
}): string {
  const from = params.fromName && params.fromEmail
    ? `${params.fromName} <${params.fromEmail}>`
    : params.fromEmail ?? params.fromName ?? 'Unknown'
  const header = [
    '---------- Forwarded message ---------',
    `From: ${from}`,
    ...(params.sentAt ? [`Date: ${new Date(params.sentAt).toUTCString()}`] : []),
    `Subject: ${params.subject ?? ''}`,
  ].join('\n')
  const note = params.note?.trim()
  return `${note ? `${note}\n\n` : ''}${header}\n\n${params.originalBody}`
}
