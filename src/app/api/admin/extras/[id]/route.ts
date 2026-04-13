import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('extras').select('*').eq('id', id).single()
  if (error) {
    const status = error.code === 'PGRST116' ? 404 : 500
    return apiError(error.message, status)
  }
  return apiOk({ extra: data })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()

  const WRITABLE = ['name','name_nl','name_de','name_fr','name_es','name_pt','name_zh',
    'description','description_nl','description_de','description_fr','description_es',
    'description_pt','description_zh','image_url','category','scope',
    'applicable_categories','price_type','price_value','vat_rate',
    'is_required','is_active','sort_order','ingredients']

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of WRITABLE) {
    if (key in body) patch[key] = body[key]
  }

  const { data, error } = await supabase.from('extras').update(patch).eq('id', id).select().single()
  if (error) return apiError(error.message)
  return apiOk({ extra: data })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('extras').delete().eq('id', id)
  if (error) return apiError(error.message)
  return apiOk({})
}
