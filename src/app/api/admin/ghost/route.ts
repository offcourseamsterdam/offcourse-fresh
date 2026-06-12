import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/ghost — the Ghost AI's notebook.
 * Latest shadow proposals with the conversation/contact they belong to and
 * the message that triggered them. Read-only: the dev page watches the
 * Ghost think; nothing here acts.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('agent_proposals')
      .select(
        `id, kind, payload, reasoning, status, model, created_at,
         conversation:conversations(id, channel, contact:contacts(name, email, locale)),
         trigger:messages!agent_proposals_trigger_message_id_fkey(body, author_name, created_at)`,
      )
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return apiError(error.message)

    return apiOk({ proposals: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load ghost proposals')
  }
}
