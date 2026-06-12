import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiOk, apiError } from '@/lib/api/response'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'
import { performClock } from '@/lib/scheduling/perform-clock'

const bodySchema = z.object({ action: z.enum(['in', 'out']) })

/**
 * POST /api/captain/clock { action: 'in' | 'out' }
 * The portal's check-in/out button. Same engine as the Slack bot (M4),
 * different source tag.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCaptain()
  if (auth instanceof NextResponse) return auth

  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError('action must be "in" or "out"', 400)

    const supabase = createAdminClient()
    const result = await performClock(supabase, auth.staff, parsed.data.action, 'portal')
    return apiOk(result)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
