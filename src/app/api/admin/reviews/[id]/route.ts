import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'

interface Ctx {
  params: Promise<{ id: string }>
}

/** PATCH /api/admin/reviews/:id — update a review (toggle active, edit text, etc.) */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createServiceClient()
  const body = await request.json()

  // Only allow updating safe fields
  const updates: Record<string, unknown> = {}
  const allowed = [
    'reviewer_name', 'review_text', 'rating', 'source',
    'is_active', 'sort_order', 'author_photo_url',
    'review_text_nl', 'review_text_de', 'review_text_fr',
    'review_text_es', 'review_text_pt', 'review_text_zh',
  ] as const
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return apiError('No valid fields to update', 400)
  }

  const { data, error } = await supabase
    .from('social_proof_reviews')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk({ review: data })
}

/** DELETE /api/admin/reviews/:id */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createServiceClient()

  const { error } = await supabase
    .from('social_proof_reviews')
    .delete()
    .eq('id', id)

  if (error) return apiError(error.message)
  return apiOk({ deleted: true })
}
