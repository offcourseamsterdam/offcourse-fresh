import { apiError, apiOk } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidChatToken, parseChatMessage } from '@/lib/chat/validate'

/**
 * Public widget endpoints, authenticated by the conversation's webchat_token
 * (a UUID URL secret — same pattern as the staff calendar feed).
 *
 *   GET  /api/chat/{token} — poll the thread (internal notes NEVER included)
 *   POST /api/chat/{token} — send a customer message
 */

interface RouteParams {
  params: Promise<{ token: string }>
}

async function findConversation(token: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('conversations')
    .select('id, status, unread_count')
    .eq('webchat_token', token)
    .eq('channel', 'webchat')
    .maybeSingle()
  return { supabase, conversation: data }
}

export async function GET(_req: Request, { params }: RouteParams): Promise<Response> {
  const { token } = await params
  if (!isValidChatToken(token)) return apiError('Not found', 404)

  const { supabase, conversation } = await findConversation(token)
  if (!conversation) return apiError('Not found', 404)

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, direction, body, author_name, created_at')
    .eq('conversation_id', conversation.id)
    // 'note' is internal-only — it must never reach the customer.
    .in('direction', ['in', 'out'])
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) return apiError('Could not load messages', 500)

  return apiOk({ status: conversation.status, messages: messages ?? [] })
}

export async function POST(req: Request, { params }: RouteParams): Promise<Response> {
  const { token } = await params
  if (!isValidChatToken(token)) return apiError('Not found', 404)

  const body = await req.json().catch(() => null)
  const parsed = parseChatMessage((body as Record<string, unknown>)?.message)
  if ('error' in parsed) return apiError(parsed.error, 400)

  const { supabase, conversation } = await findConversation(token)
  if (!conversation) return apiError('Not found', 404)

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'in',
    body: parsed.message,
  })
  if (error) return apiError('Could not send the message', 500)

  // A customer message always (re)opens the thread and bumps the badge.
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: conversation.unread_count + 1,
      status: 'open',
    })
    .eq('id', conversation.id)

  return apiOk({ sent: true })
}
