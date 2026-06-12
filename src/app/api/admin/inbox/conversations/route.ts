import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/inbox/conversations?status=open|pending|resolved|all
 * The left pane: every conversation with its contact and latest message
 * (snippet), newest activity first.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const status = req.nextUrl.searchParams.get('status') ?? 'all'
    const supabase = createAdminClient()

    let query = supabase
      .from('conversations')
      .select(
        `id, channel, status, subject, unread_count, last_message_at, created_at,
         contact:contacts(id, name, email),
         messages(body, direction, created_at)`,
      )
      .order('last_message_at', { ascending: false })
      .order('created_at', { referencedTable: 'messages', ascending: false })
      .limit(1, { referencedTable: 'messages' })
      .limit(100)

    if (status !== 'all') query = query.eq('status', status)

    const { data, error } = await query
    if (error) return apiError(error.message)

    const conversations = (data ?? []).map(c => ({
      id: c.id,
      channel: c.channel,
      status: c.status,
      subject: c.subject,
      unread_count: c.unread_count,
      last_message_at: c.last_message_at,
      contact: c.contact,
      snippet: c.messages[0]?.body ?? '',
      snippet_direction: c.messages[0]?.direction ?? null,
    }))

    return apiOk({ conversations })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load inbox')
  }
}
