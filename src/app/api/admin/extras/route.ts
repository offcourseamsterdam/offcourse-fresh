import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('extras')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) return apiError(error.message)
  return apiOk({ extras: data })
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()

  const allowed = {
    name: body.name,
    name_nl: body.name_nl ?? null,
    name_de: body.name_de ?? null,
    name_fr: body.name_fr ?? null,
    name_es: body.name_es ?? null,
    name_pt: body.name_pt ?? null,
    name_zh: body.name_zh ?? null,
    description: body.description ?? null,
    description_nl: body.description_nl ?? null,
    description_de: body.description_de ?? null,
    description_fr: body.description_fr ?? null,
    description_es: body.description_es ?? null,
    description_pt: body.description_pt ?? null,
    description_zh: body.description_zh ?? null,
    image_url: body.image_url ?? null,
    category: body.category,
    scope: body.scope,
    applicable_categories: body.applicable_categories ?? null,
    price_type: body.price_type,
    price_value: body.price_value ?? 0,
    vat_rate: body.vat_rate ?? 9,
    is_required: body.is_required ?? false,
    is_active: body.is_active ?? true,
    sort_order: body.sort_order ?? 0,
    ingredients: body.ingredients ?? null,
    quantity_mode: body.quantity_mode ?? 'toggle',
    min_quantity: body.min_quantity ?? 1,
  }

  const { data, error } = await supabase.from('extras').insert(allowed).select().single()
  if (error) return apiError(error.message)
  return apiOk({ extra: data })
}
