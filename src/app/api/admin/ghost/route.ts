import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getAiSpendSummary } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/ghost — the Ghost AI's notebook.
 * Latest shadow proposals (with outcome = the human's actual reply when
 * captured), open questions awaiting an answer, learning stats, and spend.
 * Read-only: the dev page watches the Ghost think; nothing here acts.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const [{ data, error }, spend, knowledgeRes] = await Promise.all([
      supabase
        .from('agent_proposals')
        .select(
          `id, kind, payload, reasoning, status, model, outcome, created_at,
           conversation:conversations(id, channel, contact:contacts(name, email, locale)),
           trigger:messages!agent_proposals_trigger_message_id_fkey(body, author_name, created_at)`,
        )
        .order('created_at', { ascending: false })
        .limit(50),
      getAiSpendSummary(),
      supabase.from('ghost_knowledge').select('id, question, answer, proposal_id, created_at').order('created_at', { ascending: false }),
    ])
    if (error) return apiError(error.message)

    const proposals = data ?? []
    const knowledge = knowledgeRes.data ?? []
    const answeredProposalIds = new Set(knowledge.map(k => k.proposal_id).filter(Boolean))

    // Open questions = proposals where an agent asked something and no
    // knowledge entry answers that proposal yet.
    const openQuestions = proposals
      .filter(p => {
        const q = (p.payload as { open_question?: string | null })?.open_question
        return typeof q === 'string' && q && !answeredProposalIds.has(p.id)
      })
      .map(p => ({
        proposal_id: p.id,
        question: (p.payload as { open_question?: string }).open_question as string,
        created_at: p.created_at,
      }))

    // Learning stats — the "is it learning?" dashboard.
    const conversational = proposals.filter(p => p.kind === 'reply_draft' || p.kind === 'booking_proposal')
    const stats = {
      total: proposals.length,
      byKind: proposals.reduce<Record<string, number>>((acc, p) => {
        acc[p.kind] = (acc[p.kind] ?? 0) + 1
        return acc
      }, {}),
      corrected: conversational.filter(p => p.outcome != null).length,
      awaitingComparison: conversational.filter(p => p.outcome == null).length,
      openQuestions: openQuestions.length,
      knowledgeEntries: knowledge.length,
    }

    return apiOk({ proposals, spend, stats, openQuestions })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load ghost proposals')
  }
}
