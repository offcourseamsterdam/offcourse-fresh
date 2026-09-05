import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { findOrCreateContactByField } from '@/lib/contacts/find-or-create'
import { processInvoiceFile, loadSupplierById, isPdfBuffer } from '@/lib/finance/invoices/process'
import { isUuid } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB — comfortably above a real scanned invoice
const MANUAL_UPLOAD_THREAD_ID = 'manual-invoice-uploads'
const MANUAL_UPLOAD_CONTACT_EMAIL = 'handmatig@offcourseamsterdam.internal'

/**
 * A single, persistent conversation every manual upload lands in — reusing
 * the exact same source_category='finance' + ContextPane review UI a Gmail-
 * sourced invoice gets (§6a: "the pipeline is unchanged regardless of how
 * the PDF arrives"), rather than building a separate list page for uploads.
 * Every upload adds one more message + finance_invoices row to this one
 * thread, so it stays a single, findable place in the inbox.
 */
async function findOrCreateManualUploadConversation(supabase: ReturnType<typeof createAdminClient>): Promise<{ id: string; unreadCount: number }> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, unread_count')
    .eq('provider_thread_id', MANUAL_UPLOAD_THREAD_ID)
    .maybeSingle()
  if (existing) return { id: existing.id, unreadCount: existing.unread_count ?? 0 }

  const contactId = await findOrCreateContactByField(supabase, 'email', MANUAL_UPLOAD_CONTACT_EMAIL, 'Handmatige upload')
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      channel: 'email',
      contact_id: contactId,
      provider_thread_id: MANUAL_UPLOAD_THREAD_ID,
      subject: 'Handmatig geüploade facturen',
      source_category: 'finance',
    })
    .select('id')
    .single()
  if (error || !created) throw new Error(`Could not create manual-upload conversation: ${error?.message}`)
  return { id: created.id, unreadCount: 0 }
}

/**
 * POST /api/admin/finance/cockpit/invoices/upload — multipart/form-data:
 * `file` (the PDF, required), `supplier_id` (uuid, optional — an unresolved
 * supplier still creates the invoice, same as an unrecognised email sender,
 * just with nothing to auto-match against).
 *
 * §6's fallback for a PDF that never went through Gmail. Same pipeline as
 * the email path (invoices/process.ts) end to end, just a different
 * storage-path prefix and a manual `messages` row instead of a real one.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return apiError('No file uploaded', 400)
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return apiError('Only PDF invoices are supported', 400)
    }
    if (file.size === 0) return apiError('The uploaded file is empty', 400)
    if (file.size > MAX_FILE_BYTES) return apiError(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB)`, 400)

    const supplierIdRaw = form.get('supplier_id')
    const supplierId = typeof supplierIdRaw === 'string' && supplierIdRaw ? supplierIdRaw : null
    if (supplierId && !isUuid(supplierId)) return apiError('Invalid supplier_id', 400)

    // The bytes, not the name or the Content-Type, decide whether this is a PDF.
    // Checked before any row is written so a bad file leaves nothing behind.
    const buffer = Buffer.from(await file.arrayBuffer())
    if (!isPdfBuffer(buffer)) return apiError('That file is not a PDF', 400)

    const supabase = createAdminClient()
    const supplier = supplierId ? await loadSupplierById(supabase, supplierId) : null

    const conv = await findOrCreateManualUploadConversation(supabase)
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conv.id,
        direction: 'in',
        body: `Handmatig geüpload: ${file.name}`,
        provider: 'manual',
      })
      .select('id')
      .single()
    if (msgError || !message) return apiError(msgError?.message ?? 'Could not create message row', 500)

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), unread_count: conv.unreadCount + 1, status: 'open' })
      .eq('id', conv.id)

    const { invoiceId, summary } = await processInvoiceFile(supabase, {
      buffer,
      filename: file.name,
      mimeType: 'application/pdf',
      storagePrefix: 'upload',
      supplier,
      source: 'upload',
      sourceMessageId: message.id,
      conversationId: conv.id,
    })

    return apiOk({ invoiceId, conversationId: conv.id, summary }, 201)
  } catch (err) {
    console.error('[finance/cockpit/invoices/upload]', err)
    return apiError(err instanceof Error ? err.message : 'Could not upload invoice', 500)
  }
}
