import { NextRequest, after } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'
import { analyzeDifference } from '@/lib/ghost/compare'

/**
 * POST /api/admin/ghost/proposals/[id]  { action }
 * One endpoint, three actions on a single proposal:
 *   - review:  toggle the reviewed flag (triage)
 *   - redraft: re-run the agent for this conversation (e.g. after teaching it
 *              something) — fires after the response; the new draft appears on
 *              the next poll
 *   - compare: ask Claude what the human changed vs the Ghost's draft, and
 *              store the lesson on the proposal
 * Still read-only toward customers — nothing is sent or booked.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { action?: string; reviewed?: boolean }
    const supabase = createAdminClient()

    if (body.action === 'review') {
      const reviewed_at = body.reviewed === false ? null : new Date().toISOString()
      const { error } = await supabase.from('agent_proposals').update({ reviewed_at }).eq('id', id)
      if (error) return apiError(error.message, 500)
      return apiOk({ reviewed_at })
    }

    if (body.action === 'redraft') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('conversation_id, trigger_message_id, kind')
        .eq('id', id)
        .single()
      if (!p?.conversation_id) return apiError('Only conversation proposals can be re-drafted', 400)
      // Re-run the agent off the response path; the fresh proposal polls in.
      after(() => draftShadowReply(p.conversation_id as string, p.trigger_message_id ?? null))
      return apiOk({ queued: true })
    }

    if (body.action === 'compare') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('payload, outcome, trigger:messages!agent_proposals_trigger_message_id_fkey(body)')
        .eq('id', id)
        .single()
      const draft = (p?.payload as { reply?: string } | null)?.reply
      const outcome = (p?.outcome ?? {}) as Record<string, unknown>
      const actual = typeof outcome.human_reply === 'string' ? outcome.human_reply : null
      const customer = (p?.trigger as { body?: string } | null)?.body ?? ''
      if (!draft || !actual) return apiError('Nothing to compare — needs a draft and your actual reply', 400)

      const analysis = await analyzeDifference(customer, draft, actual)
      if (!analysis) return apiError('Could not analyze the difference', 502)

      const nextOutcome = JSON.parse(JSON.stringify({ ...outcome, comparison: analysis }))
      await supabase.from('agent_proposals').update({ outcome: nextOutcome }).eq('id', id)
      return apiOk({ comparison: analysis })
    }

    return apiError('Unknown action', 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Action failed')
  }
}
