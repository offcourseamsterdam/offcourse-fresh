/**
 * A finance-alias e-mail from anyone who is NOT a staff member (plan §3.2):
 * webshop order confirmations, "your invoice is ready" mails, supplier
 * invoices with a PDF, receipt photos. Everything it carries becomes
 * finance_documents rows — the mail itself when it states matching facts, each
 * PDF/image attachment, and each invoice link — ready for the matcher.
 *
 * Staff mail (skipper invoices) never comes here; finance/inbox/ingest.ts
 * keeps routing it to the payable pipeline (plan §2.3).
 *
 * Never throws out of the poll: a failed download or extraction leaves a
 * visible, unextracted document, not a wedged sync.
 */
import { randomUUID } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/lib/supabase/types'
import { getAttachmentData, type GmailMessage } from '@/lib/gmail/client'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { displayFilename } from '@/lib/finance/invoices/process'
import { classifyFinanceEmail, extractLinks, type FinanceEmailClassification, type FinanceEmailKind } from './classify-email'
import { isCandidateAttachmentMime, MAX_DOCUMENT_BYTES, sha256Hex, sniffDocumentType } from './documents'
import { extractDocumentFields } from './extract-document'
import { fetchPublicPdf } from './fetch-link'

type Admin = ReturnType<typeof createAdminClient>
type DocumentKind = Database['public']['Tables']['finance_documents']['Row']['kind']

/** Which document kind a classified mail itself becomes; null = the mail carries no facts worth a row of its own. */
export function mailDocumentKind(kind: FinanceEmailKind | null): DocumentKind | null {
  switch (kind) {
    case 'order_confirmation': return 'order_confirmation_email'
    case 'invoice_notification': return 'invoice_notification_email'
    case 'payment_confirmation': return 'payment_confirmation_email'
    default: return null
  }
}

const LINK_SKIP = /unsubscribe|opt-?out|afmelden|uitschrijven|\/track|click\.|utm_|privacy|terms|voorwaarden/i
const LINK_HINT = /invoice|factuur|receipt|bon\b|download|\.pdf(\?|$)|document|nota/i
/** Two link fetches per mail, sequential, ≤10 s each — inside the 2-minute Gmail poll's 60 s budget with room for Claude + Gemini. */
const MAX_LINKS_TO_FETCH = 2
/** Unfetched links kept visible on the card. */
const MAX_LINKS_TO_RECORD = 5
/** Below this the classifier is guessing; a guessed "invoice notification" must not make the server GET anything. */
const MIN_CONFIDENCE_FOR_LINK_FETCH = 0.7

/**
 * Only links that look like a document get fetched; tracking, unsubscribe and
 * boilerplate links are never touched — a GET on an unsubscribe link is a side
 * effect, not a download. Everything else stays recorded as 'not_attempted'
 * so Beer can still see it on the card.
 */
export function pickLinksToFetch(links: string[]): { fetch: string[]; keep: string[] } {
  const usable = links.filter(l => !LINK_SKIP.test(l))
  const hinted = usable.filter(l => LINK_HINT.test(l))
  return { fetch: hinted.slice(0, MAX_LINKS_TO_FETCH), keep: usable.filter(l => !hinted.slice(0, MAX_LINKS_TO_FETCH).includes(l)) }
}

export interface IngestEmailResult {
  documentIds: string[]
  kind: FinanceEmailKind | null
  /** One Dutch line for the thread's ai_summary context. */
  summary: string
}

function classificationToExtracted(c: FinanceEmailClassification): Json {
  return {
    supplierName: c.supplierName,
    orderNumber: c.orderNumber,
    invoiceNumber: c.invoiceNumber,
    invoiceDate: c.invoiceDate,
    grossCents: c.grossCents,
    vatCents: c.vatCents,
    currency: c.currency,
    paymentReference: c.paymentReference,
    isPaidConfirmation: c.isPaidConfirmation,
    confidence: { overall: c.confidence },
    reason: c.reason,
  } as Json
}

export async function ingestFinanceEmailDocuments(supabase: Admin, message: GmailMessage, sourceMessageRowId: string): Promise<IngestEmailResult> {
  const documentIds: string[] = []
  const notes: string[] = []
  const links = extractLinks(message.bodyText, message.bodyHtml)
  const candidates = message.attachments.filter(a => isCandidateAttachmentMime(a.mimeType) && a.size <= MAX_DOCUMENT_BYTES)
  const oversized = message.attachments.filter(a => isCandidateAttachmentMime(a.mimeType) && a.size > MAX_DOCUMENT_BYTES)
  for (const a of oversized) notes.push(`${a.filename}: te groot (max ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB)`)

  let classification: FinanceEmailClassification | null = null
  try {
    classification = await classifyFinanceEmail({
      fromEmail: message.from.email,
      fromName: message.from.name || null,
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      hasPdfAttachment: candidates.some(a => a.mimeType.toLowerCase() === 'application/pdf'),
      hasImageAttachment: candidates.some(a => a.mimeType.toLowerCase().startsWith('image/')),
      links,
    })
  } catch (err) {
    console.error('[finance/expenses/ingest-email] classification failed:', err instanceof Error ? err.message : err)
  }
  const kind = classification?.kind ?? null

  // Nothing financial and nothing attached: leave the thread as a plain mail, no document row.
  if (candidates.length === 0 && (kind === null || kind === 'other')) {
    return { documentIds, kind, summary: [kind === 'other' ? 'Geen financiële inhoud herkend.' : 'Kon de mail niet classificeren.', ...notes].join(' · ') }
  }

  /** A document row without a file (mail facts, links). A failed insert is logged and noted, never silent. */
  const insertPlainDocument = async (row: Database['public']['Tables']['finance_documents']['Insert'], what: string): Promise<void> => {
    const { data, error } = await supabase.from('finance_documents').insert(row).select('id').single()
    if (error) {
      console.error(`[finance/expenses/ingest-email] could not record ${what}:`, error.message)
      notes.push(`${what}: vastleggen mislukt`)
      return
    }
    if (data) documentIds.push(data.id)
  }

  // 1. The mail itself, when it states facts the matcher can use.
  const mailKind = mailDocumentKind(kind)
  if (mailKind && classification) {
    await insertPlainDocument({ kind: mailKind, source: 'email', source_message_id: sourceMessageRowId, extracted: classificationToExtracted(classification) }, 'mail')
  }

  // 2. Attachments: PDFs are invoices, images are receipts — the bytes decide, not the name.
  for (const att of candidates) {
    try {
      const bytes = await getAttachmentData(message.id, att.attachmentId)
      const type = sniffDocumentType(bytes)
      if (!type || bytes.length > MAX_DOCUMENT_BYTES) {
        notes.push(`${att.filename}: geen geldige PDF of afbeelding`)
        continue
      }
      const id = await storeDocument(supabase, {
        bytes,
        ext: type.ext,
        mimeType: type.mimeType,
        kind: type.ext === 'pdf' ? 'invoice_pdf' : 'receipt_image',
        pathPrefix: `email/${message.id}`,
        originalFilename: displayFilename(att.filename),
        sourceMessageId: sourceMessageRowId,
      })
      if (id) documentIds.push(id)
    } catch (err) {
      console.error(`[finance/expenses/ingest-email] attachment ${att.filename} failed:`, err instanceof Error ? err.message : err)
      notes.push(`${att.filename}: opslaan mislukt`)
    }
  }

  // 3. Links — only when the mail confidently says an invoice is waiting somewhere and nothing was attached.
  //    Below the confidence bar the links are recorded for Beer but never fetched: the classifier's word alone must not make the server GET anything.
  if (kind === 'invoice_notification' && candidates.length === 0 && links.length > 0) {
    const picked = pickLinksToFetch(links)
    const confident = (classification?.confidence ?? 0) >= MIN_CONFIDENCE_FOR_LINK_FETCH
    const toFetch = confident ? picked.fetch : []
    const keep = confident ? picked.keep : [...picked.fetch, ...picked.keep]
    if (!confident && picked.fetch.length > 0) notes.push('links niet automatisch opgehaald (classificatie onzeker) — handmatig downloaden')
    for (const url of toFetch) {
      const result = await fetchPublicPdf(url)
      if (result.ok) {
        const id = await storeDocument(supabase, {
          bytes: result.bytes,
          ext: 'pdf',
          mimeType: 'application/pdf',
          kind: 'invoice_link',
          pathPrefix: `email/${message.id}`,
          originalFilename: 'factuur.pdf',
          sourceMessageId: sourceMessageRowId,
          linkUrl: url,
          linkFetchStatus: 'fetched',
        })
        if (id) documentIds.push(id)
      } else {
        const status = result.reason === 'timeout' || result.reason === 'network' || result.reason === 'too_large' ? 'failed' : 'blocked'
        await insertPlainDocument({ kind: 'invoice_link', source: 'email', source_message_id: sourceMessageRowId, link_url: url, link_fetch_status: status }, 'link')
        notes.push(`link niet opgehaald (${result.reason}) — handmatig downloaden`)
      }
    }
    for (const url of keep.slice(0, MAX_LINKS_TO_RECORD)) {
      await insertPlainDocument({ kind: 'invoice_link', source: 'email', source_message_id: sourceMessageRowId, link_url: url, link_fetch_status: 'not_attempted' }, 'link')
    }
  }

  const who = classification?.supplierName ?? message.from.name ?? message.from.email
  const head =
    kind === 'order_confirmation' ? `Orderbevestiging van ${who}${classification?.orderNumber ? ` (#${classification.orderNumber})` : ''}`
    : kind === 'invoice_notification' ? `Factuurmelding van ${who}`
    : kind === 'payment_confirmation' ? `Betalingsbevestiging van ${who}`
    : kind === 'invoice_attached' ? `Factuur van ${who}`
    : `Financiële mail van ${who}`
  const summary = [head, documentIds.length ? `${documentIds.length} document${documentIds.length === 1 ? '' : 'en'} vastgelegd` : null, ...notes].filter(Boolean).join(' · ')
  return { documentIds, kind, summary }
}

interface StoreInput {
  bytes: Buffer
  ext: string
  mimeType: string
  kind: DocumentKind
  pathPrefix: string
  originalFilename: string
  sourceMessageId: string
  linkUrl?: string
  linkFetchStatus?: 'fetched'
}

/** Hash → dedupe → upload (unless a duplicate) → row → Gemini extraction. Shared by attachments and fetched links. */
async function storeDocument(supabase: Admin, input: StoreInput): Promise<string | null> {
  const sha = sha256Hex(input.bytes)
  const { data: dup } = await supabase.from('finance_documents').select('id, file_path').eq('sha256', sha).maybeSingle()
  // A duplicate points at the ORIGINAL's file — its own key was never uploaded, so it must not pretend to have one.
  const path = dup ? dup.file_path : `${input.pathPrefix}/${randomUUID()}.${input.ext}`
  if (!dup) {
    const up = await uploadFinanceAttachment(supabase, path as string, input.bytes, input.mimeType)
    if (!up.ok) throw new Error(`upload failed: ${up.error}`)
  }

  const { data: doc, error } = await supabase
    .from('finance_documents')
    .insert({
      kind: input.kind,
      source: 'email',
      source_message_id: input.sourceMessageId,
      file_path: path,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      sha256: dup ? null : sha,
      duplicate_of: dup?.id ?? null,
      link_url: input.linkUrl ?? null,
      link_fetch_status: input.linkFetchStatus ?? null,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return null
    throw new Error(error.message)
  }

  if (!dup && doc) {
    try {
      const extraction = await extractDocumentFields(input.bytes.toString('base64'), input.mimeType)
      await supabase.from('finance_documents').update({ extracted: { ...extraction.fields, confidence: extraction.confidence } as Json }).eq('id', doc.id)
    } catch (err) {
      console.error(`[finance/expenses/ingest-email] extraction failed for ${input.originalFilename}:`, err instanceof Error ? err.message : err)
    }
  }
  return doc?.id ?? null
}
