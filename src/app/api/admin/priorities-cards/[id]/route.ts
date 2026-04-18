import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

const WRITABLE = ['image_url', 'alt_text', 'title', 'body', 'rotate', 'sort_order']

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of WRITABLE) {
    if (key in body) patch[key] = body[key]
  }

  const { data, error } = await supabase
    .from('priorities_cards')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk({ card: data })
}
