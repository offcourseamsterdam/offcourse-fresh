import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFinanceAttachmentSignedUrl } from '@/lib/finance/attachment-storage'

const SOURCES = {
  viator: { table: 'viator_payment_batches' as const, column: 'storage_path' as const, adminOnly: false },
  getyourguide: { table: 'getyourguide_payments' as const, column: 'storage_path' as const, adminOnly: false },
  boatlocal: { table: 'boatlocal_payout_batches' as const, column: 'storage_path' as const, adminOnly: false },
  withlocals: { table: 'withlocals_bookings' as const, column: 'storage_path' as const, adminOnly: false },
  // Supplier/skipper invoices (§6). Admin only: a finance share link is for
  // the accountant's kasboek view, not for someone's personal invoice with
  // their IBAN on it.
  invoice: { table: 'finance_invoices' as const, column: 'file_path' as const, adminOnly: true },
  // Expense Record documents (plan 2026-09-05): supplier invoices, receipt photos, Revolut receipts.
  expense_document: { table: 'finance_documents' as const, column: 'file_path' as const, adminOnly: true },
}

type Source = keyof typeof SOURCES

/**
 * GET /api/admin/finance/attachments/[source]/[id]
 *
 * Redirects to a short-lived signed URL for the original source document
 * (Viator .xlsx, GetYourGuide PDF, an emailed skipper invoice, ...) behind a
 * stored finance record — one route shared across sources so the private
 * bucket is only ever reached through an authenticated admin request, never
 * a public URL.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params
  const config = SOURCES[source as Source]
  if (!config) return apiError('Unknown attachment source', 400)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return apiError('Invalid attachment id', 400)

  const denied = config.adminOnly ? await requireAdmin() : await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from(config.table)
      .select(config.column)
      .eq('id', id)
      .maybeSingle()

    if (error) return apiError(error.message)
    const storagePath = (data as Record<string, string | null> | null)?.[config.column]
    if (!storagePath) return apiError('No attachment stored for this record', 404)

    const signedUrl = await getFinanceAttachmentSignedUrl(supabase, storagePath)
    if (!signedUrl) return apiError('Could not generate a download link', 500)

    return NextResponse.redirect(signedUrl)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
