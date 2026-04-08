// ── Types ─────────────────────────────────────────────────────────────────────

export interface CruiseListing {
  id: string
  slug: string
  title: string
  tagline: string | null
  description: string | null
  category: string
  departure_location: string | null
  duration_display: string | null
  max_guests: number | null
  starting_price: number | null
  price_display: string | null
  price_label: string | null
  hero_image_url: string | null
  images: Array<{ url: string; alt_text?: string }>
  benefits: Array<{ text: string; icon?: string }>
  highlights: Array<{ text: string }>
  inclusions: Array<{ text: string }>
  faqs: Array<{ question: string; answer: string }>
  cancellation_policy: { text?: string } | null
  boat_id: string | null
  allowed_resource_pks: number[]
  allowed_customer_type_pks: number[]
  availability_filters: Record<string, unknown>
  is_published: boolean
  is_featured: boolean
  display_order: number
  seo_title: string | null
  seo_meta_description: string | null
  fareharbor_item_pk: number
}

export interface CruiseTabProps {
  listing: CruiseListing
  onSave: (updated: CruiseListing) => void
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export async function patchListing(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/admin/cruise-listings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return res.json() as Promise<{ ok: boolean; data?: CruiseListing; error?: string }>
}

export const inputCls =
  'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/20'
