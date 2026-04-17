import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/channels
 * Returns all channels with basic info.
 *
 * POST /api/admin/tracking/channels
 * Creates a new channel.
 */
export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .order('display_order')

    if (error) return apiError(error.message)
    return apiOk(data ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, slug, description, color, icon } = body

    if (!name || !slug) {
      return apiError('Name and slug are required', 400)
    }

    const supabase = createAdminClient()

    // Get max display_order
    const { data: maxOrder } = await supabase
      .from('channels')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .single()

    const { data, error } = await supabase
      .from('channels')
      .insert({
        name,
        slug,
        description: description ?? null,
        color: color ?? '#71717a',
        icon: icon ?? 'globe',
        display_order: (maxOrder?.display_order ?? 0) + 1,
      })
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk(data, 201)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
