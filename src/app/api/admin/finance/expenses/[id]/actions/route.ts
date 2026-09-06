import type { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ExpenseActionError,
  clearReview,
  confirmMatch,
  createSupplierAndLink,
  draftExpensePayment,
  ignoreExpense,
  linkDocument,
  linkSupplier,
  loadExpenseDetail,
  markBooked,
  setManualVat,
  unignoreExpense,
  unlinkDocument,
} from '@/lib/finance/expenses/actions'
import { forwardExpenseToSnelstart, type ForwardRefusal } from '@/lib/finance/expenses/forward-snelstart'
import { expenseActionSchema } from '@/lib/finance/expenses/schemas'
import { parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

const FORWARD_REASON_TEXT: Record<ForwardRefusal, string> = {
  already_sent: 'Dit document is al naar SnelStart gestuurd.',
  no_document: 'Er is geen bestand om door te sturen (alleen een mail of een niet-opgehaalde link).',
  not_ready: 'Nog niet klaar voor SnelStart.',
  not_confirmed: 'Eerst de koppeling bevestigen: alleen een gekoppelde of klaarstaande uitgave gaat naar SnelStart.',
  vat_conflict: 'De BTW-bronnen spreken elkaar tegen. Vul eerst het juiste BTW-bedrag in.',
  ignored_or_booked: 'Genegeerde of geboekte uitgaven worden niet doorgestuurd.',
  not_configured: 'Het SnelStart-mailadres is niet ingesteld (SNELSTART_INBOX_EMAIL).',
  download_failed: 'Het bestand kon niet uit de opslag worden gelezen.',
  send_failed: 'Versturen via Gmail is mislukt.',
  not_found: 'Uitgave niet gevonden.',
}

/**
 * POST /api/admin/finance/expenses/[id]/actions
 * Body: { action: 'link'|'unlink'|'confirm'|'ignore'|'unignore'|'clear_review'|'vat'|'booked'|'forward', ... }
 * Every branch re-derives the record and returns the fresh detail.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  const parsed = await parseBody(request, expenseActionSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const body = parsed.data
    switch (body.action) {
      case 'link': await linkDocument(supabase, id, body.documentId); break
      case 'unlink': await unlinkDocument(supabase, id, body.documentId); break
      case 'confirm': await confirmMatch(supabase, id); break
      case 'ignore': await ignoreExpense(supabase, id, body.note ?? null); break
      case 'unignore': await unignoreExpense(supabase, id); break
      case 'clear_review': await clearReview(supabase, id); break
      case 'vat': await setManualVat(supabase, id, { vatCents: body.vatCents, ratePct: body.ratePct ?? null }); break
      case 'booked': await markBooked(supabase, id); break
      case 'link_supplier': await linkSupplier(supabase, id, body.supplierId); break
      case 'create_supplier': await createSupplierAndLink(supabase, id, { name: body.name, iban: body.iban }); break
      case 'draft_payment': await draftExpensePayment(supabase, id); break
      case 'forward': {
        const outcome = await forwardExpenseToSnelstart(supabase, id, { actor: 'manual' })
        if (!outcome.ok) {
          // `detail` stays server-side (storage paths, raw Gmail errors); the client gets the reason code and a human line.
          console.error('[finance/expenses/forward] refused:', outcome.reason, outcome.detail ?? '')
          return apiError(FORWARD_REASON_TEXT[outcome.reason], outcome.reason === 'not_found' ? 404 : 409, { reason: outcome.reason })
        }
        break
      }
    }
    return apiOk(await loadExpenseDetail(supabase, id))
  } catch (err) {
    if (err instanceof ExpenseActionError) return apiError(err.message, err.status)
    console.error('[finance/expenses/[id]/actions POST]', err)
    return apiError(err instanceof Error ? err.message : 'Action failed', 500)
  }
}
