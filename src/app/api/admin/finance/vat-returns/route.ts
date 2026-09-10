import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { vatReturnObligationNotes, vatReturnObligationTitle } from '@/lib/finance/vat-returns'

const MAX_SIZE_BYTES = 5 * 1024 * 1024
const QUARTER_RE = /^\d{4}-Q[1-4]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/admin/finance/vat-returns
 *
 * The "Ingediende aangiftes" archive on the kasboek's BTW tab — every BTW-aangifte actually
 * filed by the accountant, as opposed to computeBtwDashboard()'s per-source indication.
 */
export async function GET() {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_vat_returns')
      .select('id, quarter, filed_date, net_cents, vat9_owed_cents, vat21_owed_cents, voorbelasting_cents, original_filename, notes, obligation_id, created_at')
      .order('quarter', { ascending: false })
    if (error) return apiError(error.message)
    return apiOk(data ?? [])
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}

function readAmountCents(formData: FormData, key: string): number | null {
  const raw = formData.get(key)
  if (raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * POST /api/admin/finance/vat-returns
 *
 * Body: FormData { file, quarter, filedDate, direction: 'owed'|'refund', amountCents,
 *   vat9OwedCents?, vat21OwedCents?, voorbelastingCents?, notes? }
 *
 * Stores the PDF + the real numbers, then closes the matching vat:{quarter}
 * finance_obligations row (derived/vat.ts's indication) with the real figure — the same
 * {title, amount_cents, notes, status, paid_at} shape a manual "Betaald" click would leave,
 * so the nightly re-sync (cockpit/derived/sync.ts, only ever touches status='open' rows)
 * never overwrites it back to a wrong estimate. A quarter with no open obligation (already
 * settled some other way, or predates the derived-obligations feature) is skipped, not an error.
 *
 * Auth note: this is the one route that lets a finance-share-link holder (the accountant)
 * change `finance_obligations` state — every other obligation-mutation route (mark-paid,
 * PUT, DELETE, reopen) requires a full admin session. Deliberate: this route only ever
 * touches the one `vat:{quarter}` row the accountant's own filing corresponds to, it's fully
 * audited (finance_events + the archived PDF), and letting them close their own filing is the
 * point of the feature. Don't "fix" this to requireAdmin() without checking with Beer first.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const quarter = String(formData.get('quarter') ?? '')
    const filedDate = String(formData.get('filedDate') ?? '')
    const direction = String(formData.get('direction') ?? '')

    if (!file) return apiError('file is required', 400)
    if (!file.name.toLowerCase().endsWith('.pdf')) return apiError('Expected a .pdf file', 400)
    if (file.size > MAX_SIZE_BYTES) return apiError('File too large', 400)
    if (!QUARTER_RE.test(quarter)) return apiError('quarter must look like 2026-Q1', 400)
    if (!DATE_RE.test(filedDate)) return apiError('filedDate must be YYYY-MM-DD', 400)
    if (direction !== 'owed' && direction !== 'refund') return apiError("direction must be 'owed' or 'refund'", 400)

    const amountCents = readAmountCents(formData, 'amountCents')
    if (amountCents === null || amountCents < 0) return apiError('amountCents must be a non-negative number of cents', 400)
    const netCents = direction === 'refund' ? -amountCents : amountCents

    const vat9OwedCents = readAmountCents(formData, 'vat9OwedCents')
    const vat21OwedCents = readAmountCents(formData, 'vat21OwedCents')
    const voorbelastingCents = readAmountCents(formData, 'voorbelastingCents')
    const extraNotes = formData.get('notes') ? String(formData.get('notes')) : null

    const supabase = createAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `vat-returns/${quarter}.pdf`
    const uploadResult = await uploadFinanceAttachment(supabase, storagePath, buffer, 'application/pdf')
    if (!uploadResult.ok) return apiError(`Could not store attachment: ${uploadResult.error}`)

    const obligationId = await closeMatchingObligation(supabase, {
      quarter,
      filedDate,
      netCents,
      vat9OwedCents,
      vat21OwedCents,
      voorbelastingCents,
      extraNotes,
    })

    const { data, error } = await supabase
      .from('finance_vat_returns')
      .upsert(
        {
          quarter,
          filed_date: filedDate,
          net_cents: netCents,
          vat9_owed_cents: vat9OwedCents,
          vat21_owed_cents: vat21OwedCents,
          voorbelasting_cents: voorbelastingCents,
          file_path: storagePath,
          original_filename: file.name,
          obligation_id: obligationId,
          notes: extraNotes,
        },
        { onConflict: 'quarter' },
      )
      .select('id, quarter, filed_date, net_cents, obligation_id')
      .single()
    if (error) return apiError(error.message)

    return apiOk(data)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}

interface CloseObligationInput {
  quarter: string
  filedDate: string
  netCents: number
  vat9OwedCents: number | null
  vat21OwedCents: number | null
  voorbelastingCents: number | null
  extraNotes: string | null
}

/**
 * Finds the vat:{quarter} obligation the auto-sync proposed and closes it with the real
 * filed figure. Returns the obligation id if one was found (open or already paid — a
 * cancelled one was deliberately dismissed by a human and is left alone), null otherwise.
 *
 * `amount_cents` becomes the real filed amount when money is actually owed (`netCents > 0`),
 * or 0 for a refund (nothing owed) — never blindly zeroed. `reopen/route.ts` reads
 * `amount_cents` off a 'paid' row to compute its reversal delta; zeroing an "owed" row here
 * would silently corrupt that if this obligation is ever reopened.
 */
async function closeMatchingObligation(supabase: ReturnType<typeof createAdminClient>, input: CloseObligationInput): Promise<string | null> {
  const { data: obligation } = await supabase
    .from('finance_obligations')
    .select('id, status, amount_cents')
    .eq('source_key', `vat:${input.quarter}`)
    .maybeSingle()
  if (!obligation || obligation.status === 'cancelled') return null

  // The obligation's own (pre-filing) amount_cents IS the auto-computed indication this
  // filing replaces — exactly the number that was wrong for 2026-Q1/Q2. Deriving it here
  // (rather than trusting a client-supplied value) means the gap-callout in the notes can't
  // be spoofed and always reflects what was actually about to be paid.
  const title = vatReturnObligationTitle(input)
  const notes = vatReturnObligationNotes(input, { priorIndicationCents: obligation.amount_cents, extraNotes: input.extraNotes })
  const wasOpen = obligation.status === 'open'
  const newAmountCents = input.netCents > 0 ? input.netCents : 0

  let query = supabase
    .from('finance_obligations')
    .update({
      title,
      amount_cents: newAmountCents,
      notes,
      ...(wasOpen ? { status: 'paid' as const, paid_at: new Date(`${input.filedDate}T00:00:00.000Z`).toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', obligation.id)
  // Re-check status at write time, same as derived/sync.ts: a manual "Betaald" click between
  // our read and this write must win, not get silently overwritten back to 'paid' by us.
  if (wasOpen) query = query.eq('status', 'open')
  const { data: updated, error: updateError } = await query.select('id')
  if (updateError) throw new Error(updateError.message)
  if (wasOpen && (!updated || updated.length === 0)) {
    // Someone else closed it in the meantime — the archive row still gets stored by the
    // caller, but don't log events for a write that didn't happen.
    return obligation.id
  }

  await logFinanceEvent(supabase, {
    event_type: 'obligation_updated',
    actor: 'user',
    entity_type: 'obligation',
    entity_id: obligation.id,
    delta_cents: newAmountCents - obligation.amount_cents,
    payload: { title, reason: 'vat_return_filed', quarter: input.quarter },
  })
  if (wasOpen) {
    await logFinanceEvent(supabase, {
      event_type: 'obligation_paid',
      actor: 'user',
      entity_type: 'obligation',
      entity_id: obligation.id,
      delta_cents: newAmountCents,
      payload: { title, paid_at: input.filedDate, reason: 'vat_return_filed' },
    })
  }

  return obligation.id
}
