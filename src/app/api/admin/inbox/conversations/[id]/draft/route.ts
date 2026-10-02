import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'

/**
 * POST /api/admin/inbox/conversations/[id]/draft
 *
 * On-demand Ghost reply for ONE email thread. Inbound Gmail no longer
 * triggers a paid agent run automatically (most mail is notifications); this
 * is the button behind "Genereer antwoord". Drafts against the newest
 * inbound message of the thread.
 */

interface RouteParams {
  params: Promise<{ id: string }>
}

// The agent loop makes several tool calls — give it room on Vercel.
export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (error) return apiError(error.message)
    if (!conversation) return apiError('Conversation not found', 404)

    const { data: lastInbound } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', id)
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!lastInbound) return apiError('No inbound message to answer', 400)

    const result = await draftShadowReply(id, lastInbound.id)
    if (!result) return apiError('Ghost kon geen antwoord maken voor deze mail', 422)
    return apiOk({ kind: result.kind })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Draft failed')
  }
}
