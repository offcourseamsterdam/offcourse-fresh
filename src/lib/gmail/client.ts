// Raw Gmail REST API client — no googleapis SDK, matching this repo's existing
// no-SDK OAuth philosophy (see lib/google-ads/auth.ts). Only the four operations
// the inbox integration needs: list new inbox messages, fetch one in full,
// extract its plain-text body from arbitrarily nested MIME parts, and send a
// threaded reply.
import { getGmailAccessToken } from './auth'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users'

function gmailUser(): string {
  const user = process.env.GMAIL_USER
  if (!user) throw new Error('GMAIL_USER not configured')
  return user
}

async function gmailFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGmailAccessToken()
  const res = await fetch(`${GMAIL_API_BASE}/${encodeURIComponent(gmailUser())}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Gmail API ${path} failed (${res.status}): ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export interface GmailMessageRef {
  id: string
  threadId: string
}

/** Lists message ids matching a Gmail search query, paginating through all results. */
export async function listNewMessages(query: string): Promise<GmailMessageRef[]> {
  const results: GmailMessageRef[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q: query, maxResults: '50' })
    if (pageToken) params.set('pageToken', pageToken)
    const json = await gmailFetch<{ messages?: GmailMessageRef[]; nextPageToken?: string }>(
      `/messages?${params.toString()}`,
    )
    for (const m of json.messages ?? []) results.push({ id: m.id, threadId: m.threadId })
    pageToken = json.nextPageToken
  } while (pageToken)
  return results
}

export interface GmailSender {
  email: string
  name: string
}

export interface GmailMessage {
  id: string
  threadId: string
  from: GmailSender
  /**
   * Every address in the `To` header, parsed the same way `from` is. A
   * message can be addressed to several recipients at once (a shared inbox
   * plus a Cc-like alias), so this is a list, not a single sender-shaped
   * value. Used to tell which alias on the shared mailbox a message actually
   * arrived on — see `finance/inbox/detect.ts`, the first consumer.
   */
  to: GmailSender[]
  /** Cc recipients, parsed the same way. A skipper who Cc's the finance alias must still be routed to it — Gmail's `to:` search operator matches Cc, so the message is fetched either way; only the header parse decided routing. */
  cc: GmailSender[]
  subject: string
  /** The RFC 2822 `Message-ID` header — needed for In-Reply-To/References on a reply, distinct from Gmail's own `id`. */
  messageIdHeader: string | null
  bodyText: string
  /** The RAW html part, before stripHtml() runs on it — UNTRUSTED. Null when the email has no HTML part at all (plain-text-only). Only ever render this through a sanitizer (see SafeEmailHtml.tsx); never trust it as safe just because it came from our own DB. */
  bodyHtml: string | null
  /**
   * Every attachment part, metadata only — no bytes fetched yet (most
   * messages never need them; fetching every attachment on every poll would
   * be wasted work). Call getAttachmentData() for the ones that matter, e.g.
   * a PDF on a message routed to the Finance Inbox (source_category='finance').
   */
  attachments: GmailAttachmentRef[]
}

export interface GmailAttachmentRef {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

interface GmailApiPart {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailApiPart[]
}

interface GmailApiMessage {
  id: string
  threadId: string
  payload?: GmailApiPart & { headers?: { name: string; value: string }[] }
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Walks arbitrarily nested multipart MIME parts for the first plain-text body, falling back to the first HTML part (stripped to text). */
function findBodyParts(part: GmailApiPart): { plain: string | null; html: string | null } {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return { plain: decodeBase64Url(part.body.data), html: null }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return { plain: null, html: decodeBase64Url(part.body.data) }
  }
  if (part.parts) {
    let plain: string | null = null
    let html: string | null = null
    for (const sub of part.parts) {
      const found = findBodyParts(sub)
      if (found.plain && !plain) plain = found.plain
      if (found.html && !html) html = found.html
    }
    return { plain, html }
  }
  return { plain: null, html: null }
}

/**
 * Walks arbitrarily nested MIME parts collecting every real attachment — a
 * part with both a filename AND an attachmentId (Gmail never inlines an
 * attachment's bytes into `body.data` the way it does a text/html part;
 * they're always fetched separately via getAttachmentData()). A part with a
 * filename but no attachmentId (rare — a tiny inline attachment Gmail chose
 * to embed directly) is skipped rather than guessed at.
 */
function findAttachmentParts(part: GmailApiPart): GmailAttachmentRef[] {
  const found: GmailAttachmentRef[] = []
  if (part.filename && part.body?.attachmentId) {
    found.push({
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      attachmentId: part.body.attachmentId,
      size: part.body.size ?? 0,
    })
  }
  for (const sub of part.parts ?? []) {
    found.push(...findAttachmentParts(sub))
  }
  return found
}

/** Parses a `From` header ("Jane Doe <jane@example.com>" or bare "jane@example.com") into email + display name. */
export function extractSenderEmail(fromHeader: string): GmailSender {
  const match = fromHeader.match(/^(.*?)<(.+?)>\s*$/)
  if (match) {
    const email = match[2].trim().toLowerCase()
    const name = match[1].trim().replace(/^"|"$/g, '')
    return { email, name: name || email }
  }
  const email = fromHeader.trim().toLowerCase()
  return { email, name: email }
}

/**
 * Splits a `To` header on commas and parses each address the same way
 * `extractSenderEmail` does. A display name can itself contain a comma
 * ("Doe, Jane" <jane@x.com>), so splitting is comma-aware of quoted/angle
 * sections rather than a blind `.split(',')`.
 */
export function extractRecipients(toHeader: string): GmailSender[] {
  const parts: string[] = []
  let current = ''
  let inAngleBrackets = false
  let inQuotes = false
  for (const char of toHeader) {
    if (char === '"') inQuotes = !inQuotes
    if (char === '<' && !inQuotes) inAngleBrackets = true
    if (char === '>' && !inQuotes) inAngleBrackets = false
    if (char === ',' && !inAngleBrackets && !inQuotes) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts.map(p => p.trim()).filter(Boolean).map(extractSenderEmail)
}

export async function getMessage(id: string): Promise<GmailMessage> {
  const json = await gmailFetch<GmailApiMessage>(`/messages/${id}?format=full`)
  const headers = json.payload?.headers ?? []
  const header = (name: string) =>
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

  const { plain, html } = json.payload ? findBodyParts(json.payload) : { plain: null, html: null }
  const bodyText = plain ?? (html ? stripHtml(html) : '')

  return {
    id: json.id,
    threadId: json.threadId,
    from: extractSenderEmail(header('From')),
    to: extractRecipients(header('To')),
    cc: extractRecipients(header('Cc')),
    subject: header('Subject'),
    messageIdHeader: header('Message-ID') || null,
    bodyText,
    bodyHtml: html,
    attachments: json.payload ? findAttachmentParts(json.payload) : [],
  }
}

/** Fetches one attachment's raw bytes by id (from a GmailMessage's `attachments` list). */
export async function getAttachmentData(messageId: string, attachmentId: string): Promise<Buffer> {
  const json = await gmailFetch<{ data: string; size: number }>(
    `/messages/${messageId}/attachments/${attachmentId}`,
  )
  return Buffer.from(json.data, 'base64url')
}

/** Fetches just the RFC Message-ID header (metadata-only, cheaper than a full fetch) for threading a reply. */
async function getMessageIdHeader(id: string): Promise<string | null> {
  const json = await gmailFetch<GmailApiMessage>(
    `/messages/${id}?format=metadata&metadataHeaders=Message-ID`,
  )
  const headers = json.payload?.headers ?? []
  return headers.find(h => h.name.toLowerCase() === 'message-id')?.value ?? null
}

export interface OutboundAttachment {
  filename: string
  mimeType: string
  content: Buffer
}

interface ComposeAndSendParams {
  to: string
  subject: string
  body: string
  threadId?: string | null
  /** Gmail's own id (not the RFC header) of the message being replied to, if any. */
  inReplyToMessageId?: string | null
  /** Files to attach — the mail becomes multipart/mixed. Used to forward invoices to the bookkeeping mailbox. */
  attachments?: OutboundAttachment[]
}

/** RFC 2231-free, conservative filename for a Content-Disposition header: ASCII only, no quotes/CR/LF. */
function safeAttachmentFilename(name: string): string {
  // Quotes, backslashes and control characters are dropped (they'd end or escape the header value); other non-ASCII becomes '_'.
  const cleaned = name.replace(/["\\\x00-\x1f\x7f]/g, '').replace(/[^\x20-\x7E]/g, '_').trim()
  return cleaned || 'attachment'
}

export interface MimeMessageInput {
  from: string
  to: string
  subject: string
  body: string
  inReplyTo?: string | null
  attachments?: OutboundAttachment[]
  /** Injected for deterministic tests; production uses a random boundary. */
  boundary?: string
}

/**
 * Builds the raw RFC 822 message Gmail's send endpoint wants. Plain text when
 * there is nothing to attach (byte-identical to what we always sent);
 * multipart/mixed with base64 parts when there is. Pure so the tests can read it.
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  const headers = [
    `To: ${input.to}`,
    `From: ${input.from}`,
    `Subject: ${encodeRfc2047(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : []),
  ]
  const attachments = input.attachments ?? []
  if (attachments.length === 0) {
    return [...headers, 'Content-Type: text/plain; charset="UTF-8"', '', input.body].join('\r\n')
  }
  const boundary = input.boundary ?? `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
  const parts: string[] = [
    ...headers,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    // The body is UTF-8 (accents, €); declaring 7bit would let a strict receiver mangle it.
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
  ]
  for (const a of attachments) {
    const filename = safeAttachmentFilename(a.filename)
    // A header value is never a place for caller-supplied bytes: anything that isn't a plain type/subtype is octet-stream.
    const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(a.mimeType) ? a.mimeType : 'application/octet-stream'
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      // 76-char lines per RFC 2045.
      a.content.toString('base64').replace(/(.{76})/g, '$1\r\n'),
    )
  }
  parts.push(`--${boundary}--`, '')
  return parts.join('\r\n')
}

/**
 * RFC 2047 MIME encoded-word syntax for non-ASCII email headers (e.g. subject lines with
 * em-dashes, accents, or emojis). Without this, raw UTF-8 bytes in headers are interpreted
 * by mail user agents as ISO-8859-1/ASCII, causing "Ã¢Â€Â”" mojibake.
 */
function encodeRfc2047(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) {
    return text
  }
  return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`
}

async function composeAndSend(params: ComposeAndSendParams): Promise<{ id: string; threadId: string }> {
  let inReplyToHeader: string | null = null
  if (params.inReplyToMessageId) {
    // Best-effort — a lookup failure means slightly weaker threading, not a failed send.
    inReplyToHeader = await getMessageIdHeader(params.inReplyToMessageId).catch(() => null)
  }

  // Send AS the support address the customer actually wrote to (e.g. an alias
  // like cruise@ on a shared mailbox), not necessarily the authenticated
  // account itself — otherwise replies would confusingly come from a
  // different address than the one the customer emailed. Requires the support
  // address to be registered as a "Send mail as" alias in that Gmail
  // account's settings; falls back to the authenticated account if unset.
  const from = process.env.GMAIL_SUPPORT_ADDRESS || gmailUser()
  // Only a genuine reply gets a "Re:" prefix — a brand-new email (no thread,
  // no in-reply-to) keeps its subject as given.
  const isReply = !!(params.threadId || inReplyToHeader)
  const subjectLine = !isReply || /^re:/i.test(params.subject) ? params.subject : `Re: ${params.subject}`
  const raw = Buffer.from(
    buildMimeMessage({ from, to: params.to, subject: subjectLine, body: params.body, inReplyTo: inReplyToHeader, attachments: params.attachments }),
    'utf-8',
  ).toString('base64url')

  const json = await gmailFetch<{ id: string; threadId: string }>('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, ...(params.threadId ? { threadId: params.threadId } : {}) }),
  })
  return { id: json.id, threadId: json.threadId }
}

export async function sendReply(params: {
  threadId: string
  to: string
  subject: string
  body: string
  /** Gmail's own id (not the RFC header) of the message being replied to, if any. */
  inReplyToMessageId?: string | null
}): Promise<{ id: string }> {
  const result = await composeAndSend(params)
  return { id: result.id }
}

/**
 * Sends a brand-new email, starting a fresh thread — e.g. an outbound
 * catering order request to a supplier, not a reply to an existing
 * conversation. Returns the thread id so callers can store it and later
 * recognize replies landing in the same thread.
 *
 * Pass `threadId` when this is actually a resend into an already-known
 * thread (e.g. an updated catering order) — Gmail then appends to that
 * thread instead of starting a new one, so a supplier reply still lands
 * somewhere we recognize.
 */
export async function sendNewEmail(params: {
  to: string
  subject: string
  body: string
  threadId?: string | null
  attachments?: OutboundAttachment[]
}): Promise<{ id: string; threadId: string }> {
  return composeAndSend(params)
}
