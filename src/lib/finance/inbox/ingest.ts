/**
 * Turns a Finance Inbox email's PDF attachment(s) into finance_invoices rows
 * (§6a) by resolving the sender to a supplier and handing each attachment to
 * the shared pipeline in invoices/process.ts. Runs inline during the Gmail
 * poll, same as draftShadowReply/summarizeInboundEmail already do for the
 * customer pipeline, rather than a separate cron: a missing PDF or a failed
 * extraction just leaves the invoice in a state Beer can see and retry from
 * the UI, it never throws out of the poll.
 *
 * One email is not one invoice: a skipper may attach two PDFs to one mail, or
 * spread one month over several mails. Every attachment is its own
 * finance_invoices row with its own server-generated storage key; nothing
 * here assumes a 1:1 between message, PDF and shift.
 */
import type { GmailMessage } from '@/lib/gmail/client'
import { getAttachmentData } from '@/lib/gmail/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { processInvoiceFile, loadSupplierById, InvalidPdfError } from '@/lib/finance/invoices/process'
import type { SupplierForMatch } from '@/lib/finance/invoices/match'
import { ingestFinanceEmailDocuments } from '@/lib/finance/expenses/ingest-email'
import { MAX_DOCUMENT_BYTES } from '@/lib/finance/expenses/documents'
import { matchNewDocuments } from '@/lib/finance/expenses/match-orchestrator'
import type { FinanceInvoiceDetection } from './detect'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Same ceiling as the manual upload route. Gmail reports the size before we
 * download, so an oversized attachment is skipped for free instead of pulled
 * down, handed to Gemini and failed there.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = MAX_DOCUMENT_BYTES

/**
 * A known staff sender gets (or gets created) exactly one finance_suppliers
 * row keyed on staff_id — one skipper, one supplier record, reused across
 * every invoice they send. A known non-skipper supplier is loaded directly.
 * An unknown sender resolves to null: the invoice still gets created (so
 * Beer can see it and judge it) but with nothing to auto-match against.
 */
async function resolveSupplierForMatch(
  supabase: SupabaseAdmin,
  detection: FinanceInvoiceDetection,
): Promise<SupplierForMatch | null> {
  if (detection.senderKind === 'staff' && detection.staffId) {
    const staffId = detection.staffId
    const { data: staff } = await supabase.from('staff').select('name, hourly_rate_cents').eq('id', staffId).maybeSingle()
    const hourlyRateCents = staff?.hourly_rate_cents ?? null
    const loadExisting = () => supabase.from('finance_suppliers').select('id, name, iban').eq('staff_id', staffId).maybeSingle()

    const { data: existing } = await loadExisting()
    if (existing) return { id: existing.id, name: existing.name, staffId, iban: existing.iban, hourlyRateCents }

    const { data: created, error } = await supabase
      .from('finance_suppliers')
      .insert({ name: staff?.name ?? 'Onbekende skipper', staff_id: staffId })
      .select('id, name, iban')
      .single()
    if (created) return { id: created.id, name: created.name, staffId, iban: created.iban, hourlyRateCents }

    // 23505 = two of this skipper's mails in one poll raced the select-then-
    // insert above; migration 158's unique index made the second insert lose.
    // Re-read: the winner's row is the one to use.
    if (error?.code === '23505') {
      const { data: raced } = await loadExisting()
      if (raced) return { id: raced.id, name: raced.name, staffId, iban: raced.iban, hourlyRateCents }
    }
    console.error('[finance/inbox/ingest] could not create supplier row for staff', staffId, error?.message)
    return null
  }

  if (detection.senderKind === 'supplier' && detection.supplierId) {
    return loadSupplierById(supabase, detection.supplierId)
  }

  return null
}

/**
 * Entry point for the Gmail sync loop: a message detectFinanceInvoice()
 * flagged as source_category='finance'. Files every PDF attachment found; a
 * message with none is a no-op (someone emailed the finance alias without a
 * PDF — nothing to process, still visible as a normal thread). Never throws —
 * every failure downgrades to a logged, visible needs_review state instead of
 * wedging the poll, matching how the rest of syncGmailInbox already treats
 * per-message failures after the message itself is saved.
 */
export async function ingestFinanceMessage(
  supabase: SupabaseAdmin,
  message: GmailMessage,
  sourceMessageRowId: string | null,
  detection: FinanceInvoiceDetection,
  conversationId: string,
): Promise<string | null> {
  if (!sourceMessageRowId) {
    // Cannot happen in practice (syncGmailInbox only reaches this branch after
    // a successful messages insert), but every document row needs a real
    // message id to hang off, so this is the honest thing to do if it ever did.
    console.error('[finance/inbox/ingest] no source message id — skipping attachment ingestion for', message.id)
    return 'Kon bijlage niet verwerken: geen bericht-id.'
  }

  // Plan 2026-09-05 §2.3: only a STAFF sender is a payable (a skipper invoicing
  // hours → approve → Revolut draft, the pipeline below). Everyone else at the
  // finance alias — a webshop's order confirmation, a supplier's invoice for
  // something already paid by card, an unknown sender — is an Expense Record
  // document: filed, read, and handed to the matcher, never a payment draft.
  if (detection.senderKind !== 'staff') {
    const result = await ingestFinanceEmailDocuments(supabase, message, sourceMessageRowId)
    if (result.documentIds.length > 0) {
      try {
        await matchNewDocuments(supabase, result.documentIds)
      } catch (err) {
        // The documents are filed; matching is retried by the Revolut sync's orphan pass.
        console.error('[finance/inbox/ingest] matching failed:', err instanceof Error ? err.message : err)
      }
    }
    return result.summary
  }

  const pdfAttachments = message.attachments.filter(a => a.mimeType === 'application/pdf')
  if (pdfAttachments.length === 0) return null

  const supplier = await resolveSupplierForMatch(supabase, detection)
  const results: string[] = []
  for (const att of pdfAttachments) {
    if (att.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      results.push(`${att.filename}: te groot (max ${MAX_EMAIL_ATTACHMENT_BYTES / 1024 / 1024}MB), niet verwerkt`)
      continue
    }
    try {
      const buffer = await getAttachmentData(message.id, att.attachmentId)
      const { summary } = await processInvoiceFile(supabase, {
        buffer,
        filename: att.filename,
        mimeType: att.mimeType,
        storagePrefix: `email/${message.id}`,
        supplier,
        source: 'email',
        sourceMessageId: sourceMessageRowId,
        conversationId,
      })
      results.push(summary)
    } catch (err) {
      if (err instanceof InvalidPdfError) {
        results.push(`${att.filename}: geen geldige PDF, niet verwerkt`)
        continue
      }
      console.error(`[finance/inbox/ingest] could not ingest attachment ${att.filename} on message ${message.id}:`, err instanceof Error ? err.message : err)
      results.push(`${att.filename}: opslaan mislukt`)
    }
  }
  return results.join(' · ')
}
