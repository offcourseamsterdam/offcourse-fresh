import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/admin/cruise-listings/[id]
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return apiError(error.message, 404)
  return apiOk(data)
}

// PATCH /api/admin/cruise-listings/[id]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const body = await req.json()

  const allowed = [
    'title','title_nl','title_de','title_fr','title_es','title_pt','title_zh',
    'tagline','tagline_nl','tagline_de','tagline_fr','tagline_es','tagline_pt','tagline_zh',
    'description','description_nl','description_de','description_fr','description_es','description_pt','description_zh',
    'price_display','price_label','starting_price',
    'seo_title','seo_meta_description',
    'seo_title_nl','seo_title_de','seo_title_fr','seo_title_es','seo_title_pt','seo_title_zh',
    'seo_meta_description_nl','seo_meta_description_de','seo_meta_description_fr',
    'seo_meta_description_es','seo_meta_description_pt','seo_meta_description_zh',
    'boat_id',
    'allowed_resource_pks','allowed_customer_type_pks','availability_filters',
    'display_order','is_published','is_featured','category','departure_location',
    'hero_image_url','benefits','highlights','inclusions','faqs','images',
    'cancellation_policy','duration_display','max_guests','slug',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return apiError('No valid fields to update', 400)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('cruise_listings')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return apiError(error.message)
  return apiOk(data)
}
