import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFinanceAttachmentSignedUrl } from '@/lib/finance/attachment-storage'

const SOURCES = {
  viator: { table: 'viator_payment_batches' as const },
  getyourguide: { table: 'getyourguide_payments' as const },
  boatlocal: { table: 'boatlocal_payout_batches' as const },
  withlocals: { table: 'withlocals_bookings' as const },
}

type Source = keyof typeof SOURCES

/**
 * GET /api/admin/finance/attachments/[source]/[id]
 *
 * Redirects to a short-lived signed URL for the original source document
 * (Viator .xlsx, GetYourGuide PDF, ...) behind a stored finance record —
 * one route shared across sources so the private bucket is only ever
 * reached through an authenticated admin request, never a public URL.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ source: string; id: string }> }) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const { source, id } = await params
    const config = SOURCES[source as Source]
    if (!config) return apiError('Unknown attachment source', 400)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from(config.table)
      .select('storage_path')
      .eq('id', id)
      .maybeSingle()

    if (error) return apiError(error.message)
    if (!data?.storage_path) return apiError('No attachment stored for this record', 404)

    const signedUrl = await getFinanceAttachmentSignedUrl(supabase, data.storage_path)
    if (!signedUrl) return apiError('Could not generate a download link', 500)

    return NextResponse.redirect(signedUrl)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
