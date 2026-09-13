import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { runCfoAnalysis, getLatestCfoAnalysis } from '@/lib/finance/cockpit/cfo/analyze'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/cfo-analysis
 *
 * Returns the most recent AI CFO analysis, or generates one if none exists yet.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    let analysis = await getLatestCfoAnalysis(supabase)
    if (!analysis) {
      analysis = await runCfoAnalysis(supabase)
    }
    return apiOk(analysis)
  } catch (err) {
    console.error('[cfo-analysis GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not fetch CFO analysis', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/cfo-analysis
 *
 * Runs a fresh AI Fractional CFO analysis using Claude Sonnet 4.6 or Claude Opus 4.6 and live financial data.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    let modelChoice: 'sonnet' | 'opus' = 'sonnet'
    try {
      const body = (await req.json()) as { model?: string }
      if (body?.model === 'opus') modelChoice = 'opus'
    } catch {
      // Body might be empty
    }

    const supabase = createAdminClient()
    const analysis = await runCfoAnalysis(supabase, modelChoice)
    return apiOk(analysis)
  } catch (err) {
    console.error('[cfo-analysis POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not run CFO analysis', 500)
  }
}
