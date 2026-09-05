/**
 * The shared core of the §6 pipeline — upload → finance_invoices(received) →
 * Gemini extraction → shift matching → checks → Slack nudge — used by BOTH
 * entry points a PDF can arrive through: an email attachment
 * (finance/inbox/ingest.ts) and a manual upload
 * (api/admin/finance/cockpit/invoices/upload/route.ts). §6a is explicit that
 * the pipeline itself is "unchanged regardless of how the PDF arrives" — this
 * module is that shared unchanged pipeline; the two callers differ only in
 * where the bytes come from and which storage prefix they own.
 */
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { extractInvoiceFields } from '@/lib/finance/invoices/extract'
import { matchInvoice, type CandidateShift, type ExtractedInvoiceFields, type SupplierForMatch } from '@/lib/finance/invoices/match'
import { notifyInvoiceArrived } from '@/lib/finance/invoices/notify'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const CANDIDATE_WINDOW_DAYS = 3
// No tour_date extracted at all → can't narrow by date. Falls back to a
// bounded recent window rather than scanning this staff member's entire
// shift history looking for something to match.
const FALLBACK_LOOKBACK_DAYS = 30

/**
 * Thrown before anything is stored when the bytes aren't a PDF. Callers map it
 * to a 400 (upload) or a per-attachment "geen geldige PDF" line (email) rather
 * than the generic 500/"opslaan mislukt" a real storage failure gets.
 */
export class InvalidPdfError extends Error {
  constructor(filename: string) {
    super(`${filename} is not a PDF`)
    this.name = 'InvalidPdfError'
  }
}

/**
 * Every real PDF starts with the five bytes "%PDF-". A Content-Type header or
 * a ".pdf" extension is whatever the sender says it is; the first bytes are
 * what the file actually is. Anyone can email the finance alias, so this is
 * the gate, not the MIME type.
 */
export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

/**
 * The sender's filename, kept for display only. Path separators are replaced
 * (it must never look like a path anywhere it's rendered or logged) and it's
 * capped so a 2KB filename can't bloat the row.
 */
export function displayFilename(raw: string): string {
  const cleaned = raw.replace(/[\\/]+/g, '_').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200)
  return cleaned || 'factuur.pdf'
}

/** Loads a known finance_suppliers row (plus its linked staff member's hourly rate, if any) by id — shared by the email path (a sender already resolved to a supplier id) and manual upload (a human picked one from a list). */
export async function loadSupplierById(supabase: SupabaseAdmin, id: string): Promise<SupplierForMatch | null> {
  const { data } = await supabase.from('finance_suppliers').select('id, name, staff_id, iban').eq('id', id).maybeSingle()
  if (!data) return null

  let hourlyRateCents: number | null = null
  if (data.staff_id) {
    const { data: staff } = await supabase.from('staff').select('hourly_rate_cents').eq('id', data.staff_id).maybeSingle()
    hourlyRateCents = staff?.hourly_rate_cents ?? null
  }
  return { id: data.id, name: data.name, staffId: data.staff_id, iban: data.iban, hourlyRateCents }
}

/** Shifts for this skipper near the invoice's tour_date, with each one's human-readable booking ref (never the uuid) for the bookingRef match in matchInvoice(). */
export async function loadCandidateShifts(supabase: SupabaseAdmin, staffId: string, tourDate: string | null): Promise<CandidateShift[]> {
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

export async function loadExistingInvoiceNumbers(supabase: SupabaseAdmin, supplierId: string): Promise<string[]> {
  const { data } = await supabase.from('finance_invoices').select('extracted').eq('supplier_id', supplierId).not('extracted', 'is', null)
  return (data ?? [])
    .map(r => (r.extracted as ExtractedInvoiceFields | null)?.invoiceNumber)
    .filter((n): n is string => !!n)
}

export interface ProcessInvoiceFileInput {
  buffer: Buffer
  /** The sender's own filename — display only (see displayFilename). Never part of the storage key. */
  filename: string
  mimeType: string
  /**
   * finance-attachments bucket prefix the caller owns: 'email/<gmailMessageId>'
   * or 'upload'. The key under it is a server-generated uuid — a sender never
   * chooses where in the bucket their bytes land, and two attachments both
   * called "factuur.pdf" never overwrite each other.
   */
  storagePrefix: string
  supplier: SupplierForMatch | null
  source: 'email' | 'upload'
  /** The inbox `messages` row this PDF is attached to — every finance_invoices row has one, so it always shows up in the same review UI regardless of how it arrived. */
  sourceMessageId: string
  /** The conversation that message belongs to — the Slack nudge deep-links here. */
  conversationId: string
}

/**
 * One PDF, start to finish. Best-effort past the initial insert — a failure
 * in extraction/matching downgrades the row to needs_review with a note
 * rather than losing the invoice; the PDF is already safely uploaded and the
 * row already exists by that point. Returns a short Dutch status line for
 * the caller to fold into its own UI (a Gmail-sync ai_summary, an upload
 * response toast, etc.) — never throws for an extraction/matching failure,
 * only for a non-PDF (InvalidPdfError, before anything is stored) or a
 * genuine upload/insert failure the caller must surface.
 */
export async function processInvoiceFile(supabase: SupabaseAdmin, input: ProcessInvoiceFileInput): Promise<{ invoiceId: string; summary: string }> {
  const { buffer, mimeType, storagePrefix, supplier, source, sourceMessageId, conversationId } = input
  const filename = displayFilename(input.filename)

  if (!isPdfBuffer(buffer)) throw new InvalidPdfError(filename)

  const storagePath = `${storagePrefix}/${randomUUID()}.pdf`
  const uploaded = await uploadFinanceAttachment(supabase, storagePath, buffer, mimeType)
  if (!uploaded.ok) throw new Error(`upload failed: ${uploaded.error}`)

  const { data: invoice, error: insertError } = await supabase
    .from('finance_invoices')
    .insert({
      supplier_id: supplier?.id ?? null,
      status: 'received',
      file_path: storagePath,
      original_filename: filename,
      source,
      source_message_id: sourceMessageId,
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

    await notifyInvoiceArrived({
      conversationId,
      supplierName: supplier?.name ?? fields.supplierName,
      filename,
      status: match.status,
      amountCents: fields.amountCents,
      checks: match.checks,
    })

    return { invoiceId: invoice.id, summary: match.status === 'ready' ? `${filename}: klaar om te betalen` : `${filename}: nog te controleren` }
  } catch (err) {
    console.error(`[finance/invoices/process] extraction/matching failed for ${filename}:`, err instanceof Error ? err.message : err)
    await supabase
      .from('finance_invoices')
      .update({ status: 'needs_review', decision_note: 'Automatische verwerking mislukt — handmatig controleren.' })
      .eq('id', invoice.id)
    await notifyInvoiceArrived({ conversationId, supplierName: supplier?.name ?? null, filename, status: 'failed', amountCents: null, checks: [] })
    return { invoiceId: invoice.id, summary: `${filename}: automatische verwerking mislukt, handmatig controleren` }
  }
}
