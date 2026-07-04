import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * /api/admin/maintenance
 *   GET   — the maintenance board: every reported task/idea, newest first.
 *   PATCH — update a task's status (open / in_progress / done / dismissed).
 *
 * The technician email draft + its one-click send live on the Ghost ops
 * dashboard (the maintenance_task proposal); this is the durable board.
 */

const STATUSES = ['open', 'in_progress', 'done', 'dismissed'] as const

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('maintenance_tasks')
      .select(`id, title, description, priority, status, photo_urls, photo_descriptions,
        reporter, source, source_channel, proposal_id, technician_emailed_at, created_at,
        boat:boats(name)`)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return apiError(error.message)
    return apiOk({ tasks: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load maintenance tasks')
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string }
    if (!body.id) return apiError('id is required', 400)
    if (!body.status || !STATUSES.includes(body.status as (typeof STATUSES)[number])) {
      return apiError(`status must be one of: ${STATUSES.join(', ')}`, 400)
    }
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('maintenance_tasks')
      .update({ status: body.status })
      .eq('id', body.id)
    if (error) return apiError(error.message)
    return apiOk({ id: body.id, status: body.status })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to update task')
  }
}
