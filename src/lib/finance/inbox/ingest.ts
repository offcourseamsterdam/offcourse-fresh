/**
 * Turns a Finance Inbox email's PDF attachment(s) into finance_invoices rows
 * (§6a) by resolving the sender to a supplier and handing each attachment to
 * the shared pipeline in invoices/process.ts. Runs inline during the Gmail
 * poll, same as draftShadowReply/summarizeInboundEmail already do for the
 * customer pipeline, rather than a separate cron: a missing PDF or a failed
 * extraction just leaves the invoice in a state Beer can see and retry from
 * the UI, it never throws out of the poll.
 */
import type { GmailMessage } from '@/lib/gmail/client'
import { getAttachmentData } from '@/lib/gmail/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { processInvoiceFile, loadSupplierById } from '@/lib/finance/invoices/process'
import type { SupplierForMatch } from '@/lib/finance/invoices/match'
import type { FinanceInvoiceDetection } from './detect'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

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
    const { data: existing } = await supabase
      .from('finance_suppliers')
      .select('id, name, iban')
      .eq('staff_id', staffId)
      .maybeSingle()

    if (existing) {
      return { id: existing.id, name: existing.name, staffId, iban: existing.iban, hourlyRateCents: staff?.hourly_rate_cents ?? null }
    }

    const { data: created, error } = await supabase
      .from('finance_suppliers')
      .insert({ name: staff?.name ?? 'Onbekende skipper', staff_id: staffId })
      .select('id, name, iban')
      .single()
    if (error || !created) {
      console.error('[finance/inbox/ingest] could not create supplier row for staff', staffId, error?.message)
      return null
    }
    return { id: created.id, name: created.name, staffId, iban: created.iban, hourlyRateCents: staff?.hourly_rate_cents ?? null }
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
): Promise<string | null> {
  const pdfAttachments = message.attachments.filter(a => a.mimeType === 'application/pdf')
  if (pdfAttachments.length === 0) {
    return detection.trusted ? null : 'Onbekende afzender op het factuuradres, geen PDF-bijlage — controleer handmatig.'
  }
  if (!sourceMessageRowId) {
    // Cannot happen in practice (syncGmailInbox only reaches this branch after
    // a successful messages insert), but processInvoiceFile requires a real
    // message id to attach the invoice to, so this is the honest thing to do
    // if it ever somehow did.
    console.error('[finance/inbox/ingest] no source message id — skipping attachment ingestion for', message.id)
    return 'Kon bijlage niet verwerken: geen bericht-id.'
  }

  const supplier = await resolveSupplierForMatch(supabase, detection)
  const results: string[] = []
  for (const att of pdfAttachments) {
    try {
      const buffer = await getAttachmentData(message.id, att.attachmentId)
      const { summary } = await processInvoiceFile(supabase, {
        buffer,
        filename: att.filename,
        mimeType: att.mimeType,
        storagePath: `email/${message.id}/${att.filename}`,
        supplier,
        source: 'email',
        sourceMessageId: sourceMessageRowId,
      })
      results.push(summary)
    } catch (err) {
      console.error(`[finance/inbox/ingest] could not ingest attachment ${att.filename} on message ${message.id}:`, err instanceof Error ? err.message : err)
      results.push(`${att.filename}: opslaan mislukt`)
    }
  }
  return results.join(' · ')
}
