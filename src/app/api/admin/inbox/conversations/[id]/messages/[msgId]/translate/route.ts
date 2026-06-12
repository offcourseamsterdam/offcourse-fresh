import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { translateToEnglish } from '@/lib/chat/translate'

/**
 * POST /api/admin/inbox/conversations/[id]/messages/[msgId]/translate
 * On-demand translation of a single inbound message for the admin view.
 * Calls Claude Sonnet — cheap, ~1s per message.
 * Returns { translation, detected_language } or { translation: null } if already English.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id: conversationId, msgId } = await params

  const supabase = createAdminClient()

  const { data: msg, error } = await supabase
    .from('messages')
    .select('id, body, direction, conversation_id')
    .eq('id', msgId)
    .eq('conversation_id', conversationId)
    .single()

  if (error || !msg) return apiError('Message not found', 404)
  if (msg.direction !== 'in') return apiError('Only inbound messages can be translated', 400)

  try {
    const result = await translateToEnglish(msg.body)
    return apiOk({ translation: result?.translation ?? null, detected_language: result?.detected_language ?? null })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Translation failed', 500)
  }
}
