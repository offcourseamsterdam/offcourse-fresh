import { after } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseChatStart } from '@/lib/chat/validate'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'

/**
 * POST /api/chat/start — the public widget opens a conversation.
 * Body: { name, email, message, locale? }
 * Returns: { token } — the widget stores it in localStorage and uses it
 * as its bearer secret for the rest of the conversation.
 *
 * Contact convergence: contacts are unique on email, so a returning
 * customer (same email) reuses their contact row — and if they still have
 * an open webchat conversation, we append to it instead of opening a
 * duplicate thread.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null)
  const parsed = parseChatStart(body)
  if ('error' in parsed) return apiError(parsed.error, 400)
  const { name, email, message } = parsed.payload
  const locale = typeof (body as Record<string, unknown>)?.locale === 'string'
    ? ((body as Record<string, unknown>).locale as string).slice(0, 5)
    : null

  const supabase = createAdminClient()

  // Find-or-create the contact by email.
  const { data: existing } = await supabase
    .from('contacts').select('id, name').eq('email', email).maybeSingle()

  let contactId = existing?.id
  if (!contactId) {
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({ name, email, locale })
      .select('id')
      .single()
    if (error || !created) return apiError('Could not start the chat', 500)
    contactId = created.id
  } else if (existing && existing.name !== name) {
    // People correct their own name; the newest version wins.
    await supabase.from('contacts').update({ name }).eq('id', contactId)
  }

  // Reuse an open webchat conversation for this contact if there is one.
  const { data: openConvo } = await supabase
    .from('conversations')
    .select('id, webchat_token, unread_count')
    .eq('contact_id', contactId)
    .eq('channel', 'webchat')
    .in('status', ['open', 'pending'])
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversationId = openConvo?.id
  let token = openConvo?.webchat_token

  if (!conversationId) {
    const { data: convo, error } = await supabase
      .from('conversations')
      .insert({
        channel: 'webchat',
        contact_id: contactId,
        subject: message.length > 80 ? `${message.slice(0, 77)}…` : message,
      })
      .select('id, webchat_token')
      .single()
    if (error || !convo) return apiError('Could not start the chat', 500)
    conversationId = convo.id
    token = convo.webchat_token
  }

  const { data: inserted, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'in',
      body: message,
      author_name: name,
    })
    .select('id')
    .single()
  if (msgError) return apiError('Could not send the message', 500)

  // The Ghost drafts what it would reply — after the response is sent,
  // shadow-only, never blocks or breaks the customer flow.
  after(() => draftShadowReply(conversationId, inserted?.id ?? null))

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: (openConvo?.unread_count ?? 0) + 1,
      status: 'open',
    })
    .eq('id', conversationId)

  return apiOk({ token })
}
