import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getUserProfile } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/ghost/knowledge — teach the Ghost something.
 * Body: { question, answer, proposal_id? }
 * Each entry is injected into every future draft prompt (newest 20), so
 * an answer here permanently changes the Ghost's behavior.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const json = await req.json().catch(() => null)
    const question = typeof json?.question === 'string' ? json.question.trim() : ''
    const answer = typeof json?.answer === 'string' ? json.answer.trim() : ''
    const proposalId = typeof json?.proposal_id === 'string' ? json.proposal_id : null
    if (!question || question.length > 500) return apiError('Question is required (max 500 chars)', 400)
    if (!answer || answer.length > 2000) return apiError('Answer is required (max 2000 chars)', 400)

    const profile = await getUserProfile()
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('ghost_knowledge')
      .insert({
        question,
        answer,
        source: proposalId ? 'question_panel' : 'manual',
        proposal_id: proposalId,
        created_by: profile?.display_name ?? null,
      })
      .select('id')
      .single()
    if (error || !data) return apiError(error?.message ?? 'Could not save', 500)

    return apiOk({ id: data.id })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to save knowledge')
  }
}
