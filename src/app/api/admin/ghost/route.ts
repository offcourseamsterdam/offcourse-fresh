import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getAiSpendSummary } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'

const PROPOSAL_SELECT = `id, kind, payload, reasoning, status, model, outcome, reviewed_at, created_at,
   conversation:conversations(id, channel, contact:contacts(name, email, locale)),
   trigger:messages!agent_proposals_trigger_message_id_fkey(body, author_name, created_at)`

/**
 * GET /api/admin/ghost?limit=25&reviewed=all|unreviewed
 * The Ghost AI's notebook: a page of proposals (newest first), open questions
 * across ALL conversations, true table-wide stats (via the ghost_stats RPC),
 * spend, and the taught-knowledge list. Read-only.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 25)))
    const reviewedFilter = req.nextUrl.searchParams.get('reviewed') === 'unreviewed'

    let proposalsQuery = supabase
      .from('agent_proposals')
      .select(PROPOSAL_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (reviewedFilter) proposalsQuery = proposalsQuery.is('reviewed_at', null)

    const [{ data, error }, statsRes, spend, knowledgeRes, openQ] = await Promise.all([
      proposalsQuery,
      supabase.rpc('ghost_stats'),
      getAiSpendSummary(),
      // Newest-first, capped — this is the Ghost's long-term memory and grows
      // forever; an unbounded select on the 15s dashboard poll is the same
      // egress shape we fixed in the inbox. The UI paginates anyway.
      supabase
        .from('ghost_knowledge')
        .select('id, question, answer, proposal_id, pinned, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      // Open questions span ALL proposals, not just this page.
      supabase
        .from('agent_proposals')
        .select('id, payload, created_at, conversation:conversations(contact:contacts(name))')
        .not('payload->>open_question', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (error) return apiError(error.message)

    const proposals = data ?? []
    const knowledge = knowledgeRes.data ?? []
    const answeredProposalIds = new Set(knowledge.map(k => k.proposal_id).filter(Boolean))

    const openQuestions = (openQ.data ?? [])
      .filter(p => {
        const q = (p.payload as { open_question?: string | null })?.open_question
        return typeof q === 'string' && q.trim() && !answeredProposalIds.has(p.id)
      })
      .map(p => ({
        proposal_id: p.id,
        question: (p.payload as { open_question?: string }).open_question as string,
        contact: (p.conversation as { contact?: { name?: string } } | null)?.contact?.name ?? null,
        created_at: p.created_at,
      }))

    const stats = (statsRes.data as Record<string, unknown> | null) ?? {}

    return apiOk({
      proposals,
      hasMore: proposals.length === limit,
      spend,
      stats: { ...stats, openQuestions: openQuestions.length },
      openQuestions,
      knowledge,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load ghost proposals')
  }
}
