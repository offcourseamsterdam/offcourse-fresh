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
  subject: string
  /** The RFC 2822 `Message-ID` header — needed for In-Reply-To/References on a reply, distinct from Gmail's own `id`. */
  messageIdHeader: string | null
  bodyText: string
  /** The RAW html part, before stripHtml() runs on it — UNTRUSTED. Null when the email has no HTML part at all (plain-text-only). Only ever render this through a sanitizer (see SafeEmailHtml.tsx); never trust it as safe just because it came from our own DB. */
  bodyHtml: string | null
}

interface GmailApiPart {
  mimeType?: string
  body?: { data?: string }
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
    subject: header('Subject'),
    messageIdHeader: header('Message-ID') || null,
    bodyText,
    bodyHtml: html,
  }
}

/** Fetches just the RFC Message-ID header (metadata-only, cheaper than a full fetch) for threading a reply. */
async function getMessageIdHeader(id: string): Promise<string | null> {
  const json = await gmailFetch<GmailApiMessage>(
    `/messages/${id}?format=metadata&metadataHeaders=Message-ID`,
  )
  const headers = json.payload?.headers ?? []
  return headers.find(h => h.name.toLowerCase() === 'message-id')?.value ?? null
}

interface ComposeAndSendParams {
  to: string
  subject: string
  body: string
  threadId?: string | null
  /** Gmail's own id (not the RFC header) of the message being replied to, if any. */
  inReplyToMessageId?: string | null
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
  const lines = [
    `To: ${params.to}`,
    `From: ${from}`,
    `Subject: ${subjectLine}`,
    ...(inReplyToHeader ? [`In-Reply-To: ${inReplyToHeader}`, `References: ${inReplyToHeader}`] : []),
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body,
  ]
  const raw = Buffer.from(lines.join('\r\n'), 'utf-8').toString('base64url')

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
}): Promise<{ id: string; threadId: string }> {
  return composeAndSend(params)
}
