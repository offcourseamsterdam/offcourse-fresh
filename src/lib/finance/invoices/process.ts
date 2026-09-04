/**
 * The shared core of the §6 pipeline — upload → finance_invoices(received) →
 * Gemini extraction → shift matching → checks — used by BOTH entry points a
 * PDF can arrive through: an email attachment (gmail/inbox/ingest.ts) and a
 * manual upload (api/admin/finance/cockpit/invoices/upload/route.ts). §6a is
 * explicit that the pipeline itself is "unchanged regardless of how the PDF
 * arrives" — this module is that shared unchanged pipeline; the two callers
 * differ only in where the bytes and the storage path come from.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { extractInvoiceFields } from '@/lib/finance/invoices/extract'
import { matchInvoice, type CandidateShift, type ExtractedInvoiceFields, type SupplierForMatch } from '@/lib/finance/invoices/match'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const CANDIDATE_WINDOW_DAYS = 3
// No tour_date extracted at all → can't narrow by date. Falls back to a
// bounded recent window rather than scanning this staff member's entire
// shift history looking for something to match.
const FALLBACK_LOOKBACK_DAYS = 30

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
  filename: string
  mimeType: string
  /** finance-attachments bucket path — callers pick the prefix (email/... vs upload/...). */
  storagePath: string
  supplier: SupplierForMatch | null
  source: 'email' | 'upload'
  /** The inbox `messages` row this PDF is attached to — every finance_invoices row has one, so it always shows up in the same ContextPane review UI regardless of how it arrived. */
  sourceMessageId: string
}

/**
 * One PDF, start to finish. Best-effort past the initial insert — a failure
 * in extraction/matching downgrades the row to needs_review with a note
 * rather than losing the invoice; the PDF is already safely uploaded and the
 * row already exists by that point. Returns a short Dutch status line for
 * the caller to fold into its own UI (a Gmail-sync ai_summary, an upload
 * response toast, etc.) — never throws for an extraction/matching failure,
 * only for a genuine upload/insert failure the caller must surface.
 */
export async function processInvoiceFile(supabase: SupabaseAdmin, input: ProcessInvoiceFileInput): Promise<{ invoiceId: string; summary: string }> {
  const { buffer, filename, mimeType, storagePath, supplier, source, sourceMessageId } = input

  const uploaded = await uploadFinanceAttachment(supabase, storagePath, buffer, mimeType)
  if (!uploaded.ok) throw new Error(`upload failed: ${uploaded.error}`)

  const { data: invoice, error: insertError } = await supabase
    .from('finance_invoices')
    .insert({
      supplier_id: supplier?.id ?? null,
      status: 'received',
      file_path: storagePath,
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

    return { invoiceId: invoice.id, summary: match.status === 'ready' ? `${filename}: klaar om te betalen` : `${filename}: nog te controleren` }
  } catch (err) {
    console.error(`[finance/invoices/process] extraction/matching failed for ${filename}:`, err instanceof Error ? err.message : err)
    await supabase
      .from('finance_invoices')
      .update({ status: 'needs_review', decision_note: 'Automatische verwerking mislukt — handmatig controleren.' })
      .eq('id', invoice.id)
    return { invoiceId: invoice.id, summary: `${filename}: automatische verwerking mislukt, handmatig controleren` }
  }
}
