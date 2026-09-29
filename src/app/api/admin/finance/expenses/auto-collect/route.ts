import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { parseBody } from '@/lib/finance/cockpit/schemas'
import { setAutoCollectSender } from '@/lib/finance/expenses/auto-collect'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ documentId: z.string().uuid(), enabled: z.boolean() })

/**
 * POST /api/admin/finance/expenses/auto-collect { documentId, enabled }
 *
 * "This sender is paid by automatic direct debit" (Simyo, energy, …). Flags the
 * document now and remembers the sender's e-mail so every future mail from them
 * is flagged at ingest. Undo = enabled:false.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const parsed = await parseBody(request, bodySchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: doc, error } = await supabase
      .from('finance_documents')
      .select('id, extracted, message:messages!inner(conversation:conversations!inner(contact:contacts(email)))')
      .eq('id', parsed.data.documentId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!doc) return apiError('Document niet gevonden.', 404)

    // The Gmail From stamped at ingest; the thread's contact is only the first sender, so it's the fallback for older documents.
    const stamped = (doc.extracted as { senderEmail?: unknown } | null)?.senderEmail
    const email = typeof stamped === 'string' && stamped ? stamped : doc.message?.conversation?.contact?.email
    if (!email) return apiError('Geen afzender bekend bij dit document.', 409)

    await setAutoCollectSender(supabase, email, parsed.data.enabled)
    const extracted = { ...((doc.extracted as Record<string, unknown> | null) ?? {}), willBeAutoCollected: parsed.data.enabled }
    const { error: upErr } = await supabase.from('finance_documents').update({ extracted: extracted as unknown as Json }).eq('id', doc.id)
    if (upErr) throw new Error(upErr.message)
    return apiOk({ email, enabled: parsed.data.enabled })
  } catch (err) {
    console.error('[finance/expenses/auto-collect POST]', err)
    return apiError(err instanceof Error ? err.message : 'Kon afzender niet onthouden', 500)
  }
}
