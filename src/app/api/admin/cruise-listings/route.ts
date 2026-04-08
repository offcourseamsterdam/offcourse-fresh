import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type ListingInsert = Database['public']['Tables']['cruise_listings']['Insert']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      fareharbor_item_pk,
      slug,
      title,
      category,
      allowed_resource_pks,
      allowed_customer_type_pks,
      availability_filters,
    } = body

    if (!fareharbor_item_pk || !slug || !title) {
      return apiError('fareharbor_item_pk, slug, and title are required', 400)
    }

    const supabase = await createServiceClient()
    const insert: ListingInsert = {
      fareharbor_item_pk,
      slug,
      title,
      category: category ?? 'standard',
      allowed_resource_pks: allowed_resource_pks ?? [],
      allowed_customer_type_pks: allowed_customer_type_pks ?? [],
      availability_filters: availability_filters ?? {},
      is_published: false,
      is_featured: false,
      display_order: 0,
      benefits: [],
      highlights: [],
      inclusions: [],
      faqs: [],
      images: [],
      cancellation_policy: null,
    }

    const { data, error } = await supabase
      .from('cruise_listings')
      .insert(insert)
      .select('id, slug, title')
      .single()

    if (error) return apiError(error.message)
    return apiOk({ listing: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
