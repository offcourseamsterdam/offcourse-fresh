import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { locales } from '@/lib/i18n/config'

const WRITABLE = ['image_url', 'alt_text', 'title', 'body', 'rotate', 'sort_order', 'polaroid_color', 'title_color']

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
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

  // Flush the cached homepage so the change shows immediately.
  for (const locale of locales) revalidatePath(`/${locale}`)

  return apiOk({ card: data })
}
