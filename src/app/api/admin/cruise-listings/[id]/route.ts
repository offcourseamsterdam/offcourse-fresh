import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { locales } from '@/lib/i18n/config'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/admin/cruise-listings/[id]
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
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

// DELETE /api/admin/cruise-listings/[id]
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  const supabase = createAdminClient()

  // Safety check: refuse if there are any confirmed/booked/pending bookings
  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', id)
    .in('status', ['confirmed', 'booked', 'pending'])

  if (count && count > 0) {
    return apiError(`Cannot delete — ${count} active booking${count === 1 ? '' : 's'} linked to this listing.`, 409)
  }

  const { error } = await supabase.from('cruise_listings').delete().eq('id', id)
  if (error) return apiError(error.message)
  return apiOk({ deleted: true })
}

// PATCH /api/admin/cruise-listings/[id]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
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
    'boat_id','fareharbor_item_pk',
    'allowed_resource_pks','allowed_customer_type_pks','availability_filters',
    'display_order','is_published','is_featured','category','departure_location',
    'google_maps_url','video_url',
    'hero_image_url','hero_image_asset_id','benefits','highlights','inclusions','faqs','images',
    'cancellation_policy','duration_display','max_guests','slug',
    'payment_mode','required_partner_id',
    'booking_cutoff_hours',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return apiError('No valid fields to update', 400)
  }

  // Partner-invoice listings require a partner. The DB has a check constraint
  // that enforces this, but failing fast here gives a friendlier error.
  if (patch.payment_mode === 'partner_invoice' && !patch.required_partner_id) {
    const { data: existing } = await createAdminClient()
      .from('cruise_listings')
      .select('required_partner_id')
      .eq('id', id)
      .single()
    if (!existing?.required_partner_id) {
      return apiError('Partner-invoice listings need a partner. Pick one before saving.', 400)
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('cruise_listings')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return apiError(error.message)

  // Purge the Next.js page cache for this listing across all locales so the
  // public-facing cruise page reflects the change immediately (no stale photo,
  // price, or text showing up after an admin edit).
  for (const locale of locales) {
    revalidatePath(`/${locale}/cruises/${data.slug}`)
  }

  return apiOk(data)
}
