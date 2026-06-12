import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getUserProfile } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseChatMessage } from '@/lib/chat/validate'

/**
 * POST /api/admin/inbox/conversations/{id}/messages
 * Body: { body, direction: 'out' | 'note' }
 *
 * 'out'  → a reply the customer sees in the widget; thread flips to
 *          'pending' (waiting on the customer — §8b of the inbox plan).
 * 'note' → internal margin-scribble, never delivered anywhere.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const json = await req.json().catch(() => null)

    const direction = json?.direction
    if (direction !== 'out' && direction !== 'note') {
      return apiError("direction must be 'out' or 'note'", 400)
    }
    const parsed = parseChatMessage(json?.body)
    if ('error' in parsed) return apiError(parsed.error, 400)

    const supabase = createAdminClient()
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (!conversation) return apiError('Conversation not found', 404)

    const profile = await getUserProfile()
    const authorName = profile?.display_name || 'Off Course'

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: id,
        direction,
        body: parsed.message,
        author_name: authorName,
        // Webchat replies are "delivered" the moment they're stored — the
        // widget polls them. Real send-status tracking arrives with WhatsApp.
        status: direction === 'out' ? 'sent' : 'received',
      })
      .select('id, direction, body, author_name, status, error, created_at')
      .single()
    if (error || !message) return apiError(error?.message ?? 'Could not save message', 500)

    if (direction === 'out') {
      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          // Replied → ball is in the customer's court.
          status: conversation.status === 'resolved' ? 'resolved' : 'pending',
        })
        .eq('id', id)
    }

    return apiOk({ message })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to send message')
  }
}
