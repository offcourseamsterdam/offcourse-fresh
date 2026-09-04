/**
 * Turns a Finance Inbox email's PDF attachment(s) into finance_invoices rows,
 * end to end: upload → resolve supplier → Gemini extraction → shift matching
 * → checks (§6/§6a, docs/plans/2026-09-04-financial-management-module.md).
 *
 * The only genuinely new I/O in the pipeline — extractInvoiceFields() and
 * matchInvoice() are already pure and fixture-tested; this is the wiring
 * between them and Gmail/Supabase. Runs inline during the Gmail poll, same
 * as draftShadowReply/summarizeInboundEmail already do for the customer
 * pipeline, rather than a separate cron: a missing PDF or a failed
 * extraction just leaves the invoice in a state Beer can see and retry from
 * the UI, it never throws out of the poll.
 */
import type { GmailMessage } from '@/lib/gmail/client'
import { getAttachmentData } from '@/lib/gmail/client'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { extractInvoiceFields } from '@/lib/finance/invoices/extract'
import { matchInvoice, type CandidateShift, type ExtractedInvoiceFields, type SupplierForMatch } from '@/lib/finance/invoices/match'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'
import type { FinanceInvoiceDetection } from './detect'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const CANDIDATE_WINDOW_DAYS = 3
// No tour_date extracted at all → can't narrow by date. Falls back to a
// bounded recent window rather than scanning this staff member's entire
// shift history looking for something to match.
const FALLBACK_LOOKBACK_DAYS = 30

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
    const { data } = await supabase
      .from('finance_suppliers')
      .select('id, name, staff_id, iban')
      .eq('id', detection.supplierId)
      .maybeSingle()
    if (!data) return null

    let hourlyRateCents: number | null = null
    if (data.staff_id) {
      const { data: staff } = await supabase.from('staff').select('hourly_rate_cents').eq('id', data.staff_id).maybeSingle()
      hourlyRateCents = staff?.hourly_rate_cents ?? null
    }
    return { id: data.id, name: data.name, staffId: data.staff_id, iban: data.iban, hourlyRateCents }
  }

  return null
}

/** Shifts for this skipper near the invoice's tour_date, with each one's human-readable booking ref (never the uuid) for the bookingRef match in matchInvoice(). */
async function loadCandidateShifts(supabase: SupabaseAdmin, staffId: string, tourDate: string | null): Promise<CandidateShift[]> {
  const [from, to] = tourDate
    ? [addDays(tourDate, -CANDIDATE_WINDOW_DAYS), addDays(tourDate, CANDIDATE_WINDOW_DAYS)]
    : [addDays(todayISO(), -FALLBACK_LOOKBACK_DAYS), todayISO()]

  const { data: shifts } = await supabase
    .from('shifts')
    .select('id, booking_id, date, start_at, end_at')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled')
    .gte('date', from)
    .lte('date', to)

  const rows = shifts ?? []
  const bookingUuids = [...new Set(rows.map(s => s.booking_id).filter((id): id is string => !!id))]
  const { data: bookings } = bookingUuids.length
    ? await supabase.from('bookings').select('id, booking_id').in('id', bookingUuids)
    : { data: [] as { id: string; booking_id: string }[] }
  const refByUuid = new Map((bookings ?? []).map(b => [b.id, b.booking_id]))

  return rows.map(s => ({
    id: s.id,
    bookingId: s.booking_id,
    bookingRef: s.booking_id ? (refByUuid.get(s.booking_id) ?? null) : null,
    date: s.date,
    startAt: s.start_at,
    endAt: s.end_at,
  }))
}

async function loadExistingInvoiceNumbers(supabase: SupabaseAdmin, supplierId: string): Promise<string[]> {
  const { data } = await supabase.from('finance_invoices').select('extracted').eq('supplier_id', supplierId).not('extracted', 'is', null)
  return (data ?? [])
    .map(r => (r.extracted as ExtractedInvoiceFields | null)?.invoiceNumber)
    .filter((n): n is string => !!n)
}

/**
 * One PDF attachment, start to finish. Best-effort past the initial insert —
 * a failure in extraction/matching downgrades the row to needs_review with a
 * note rather than losing the invoice; the PDF is already safely uploaded
 * and the row already exists by that point.
 */
async function ingestOneAttachment(
  supabase: SupabaseAdmin,
  gmailMessageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string,
  supplier: SupplierForMatch | null,
  sourceMessageRowId: string | null,
): Promise<string> {
  const buffer = await getAttachmentData(gmailMessageId, attachmentId)
  const path = `email/${gmailMessageId}/${filename}`
  const uploaded = await uploadFinanceAttachment(supabase, path, buffer, mimeType)
  if (!uploaded.ok) throw new Error(`upload failed: ${uploaded.error}`)

  const { data: invoice, error: insertError } = await supabase
    .from('finance_invoices')
    .insert({
      supplier_id: supplier?.id ?? null,
      status: 'received',
      file_path: path,
      source: 'email',
      source_message_id: sourceMessageRowId,
    })
    .select('id')
    .single()
  if (insertError || !invoice) throw new Error(`could not create finance_invoices row: ${insertError?.message}`)

  try {
    const { fields } = await extractInvoiceFields(buffer.toString('base64'))
    const candidateShifts = supplier?.staffId ? await loadCandidateShifts(supabase, supplier.staffId, fields.tourDate) : []
    const existingInvoiceNumbers = supplier ? await loadExistingInvoiceNumbers(supabase, supplier.id) : []

    const match = matchInvoice({ extracted: fields, supplier, candidateShifts, existingInvoiceNumbers })

    await supabase
      .from('finance_invoices')
      .update({
        status: match.status,
        extracted: fields as unknown as Json,
        matched_shift_id: match.matchedShiftId,
        matched_booking_id: match.matchedBookingId,
        expected_amount_cents: match.expectedAmountCents,
        checks: match.checks as unknown as Json,
      })
      .eq('id', invoice.id)

    return match.status === 'ready' ? `${filename}: klaar om te betalen` : `${filename}: nog te controleren`
  } catch (err) {
    console.error(`[finance/inbox/ingest] extraction/matching failed for ${filename}:`, err instanceof Error ? err.message : err)
    await supabase
      .from('finance_invoices')
      .update({ status: 'needs_review', decision_note: 'Automatische verwerking mislukt — handmatig controleren.' })
      .eq('id', invoice.id)
    return `${filename}: automatische verwerking mislukt, handmatig controleren`
  }
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

  const supplier = await resolveSupplierForMatch(supabase, detection)
  const results: string[] = []
  for (const att of pdfAttachments) {
    try {
      results.push(await ingestOneAttachment(supabase, message.id, att.attachmentId, att.filename, att.mimeType, supplier, sourceMessageRowId))
    } catch (err) {
      console.error(`[finance/inbox/ingest] could not ingest attachment ${att.filename} on message ${message.id}:`, err instanceof Error ? err.message : err)
      results.push(`${att.filename}: opslaan mislukt`)
    }
  }
  return results.join(' · ')
}
