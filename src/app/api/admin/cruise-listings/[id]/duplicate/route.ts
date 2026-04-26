import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: source, error: fetchError } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !source) return apiError('Listing not found', 404)

  // Find a unique slug: try <slug>-copy, then <slug>-copy-2, etc.
  let newSlug = `${source.slug}-copy`
  for (let i = 2; i <= 10; i++) {
    const { data: existing } = await supabase
      .from('cruise_listings')
      .select('id')
      .eq('slug', newSlug)
      .maybeSingle()
    if (!existing) break
    newSlug = `${source.slug}-copy-${i}`
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = source

  const { data: created, error: insertError } = await supabase
    .from('cruise_listings')
    .insert({
      ...rest,
      slug: newSlug,
      title: `${source.title} (copy)`,
      is_published: false,
      is_featured: false,
      display_order: 0,
    })
    .select('id, slug, title')
    .single()

  if (insertError) return apiError(insertError.message)
  return apiOk({ listing: created })
}
