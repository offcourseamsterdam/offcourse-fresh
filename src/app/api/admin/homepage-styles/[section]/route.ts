import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { SECTION_DEF_BY_KEY, type SectionKey, type TextRoleKey } from '@/lib/homepage/section-styles'
import { locales } from '@/lib/i18n/config'

const HEX = /^#[0-9a-fA-F]{6}$/
const ROLES: TextRoleKey[] = ['h2', 'h3', 'body']

interface RouteParams {
  params: Promise<{ section: string }>
}

// PATCH /api/admin/homepage-styles/[section]
// Body: { text_colors?: { h2?, h3?, body? }, clearBackground?: boolean }
// A null/empty colour value clears that role back to its coded default.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { section } = await params
  if (!SECTION_DEF_BY_KEY[section as SectionKey]) return apiError('Unknown section', 404)

  const body = await req.json().catch(() => ({}))
  const supabase = createAdminClient()

  // Clear the background → null, WITHOUT touching the text colours (separate column).
  if (body?.clearBackground === true) {
    const { error } = await supabase
      .from('homepage_section_styles')
      .upsert(
        { section_key: section, background: null, updated_at: new Date().toISOString() },
        { onConflict: 'section_key' },
      )
    if (error) return apiError(error.message)
  }

  // Decorative Polaroid image(s) — set to a URL, or '' / null to remove.
  for (const field of ['decoration_image_url', 'decoration_image_url_2'] as const) {
    if (typeof body?.[field] === 'undefined') continue
    const url = body[field] ? String(body[field]) : null
    const { error } = await supabase
      .from('homepage_section_styles')
      .upsert(
        { section_key: section, [field]: url, updated_at: new Date().toISOString() },
        { onConflict: 'section_key' },
      )
    if (error) return apiError(error.message)
  }

  // Colour changes → one atomic per-role merge each (set_section_text_color),
  // so rapid successive saves can never clobber one another.
  const incoming = body?.text_colors
  if (incoming && typeof incoming === 'object') {
    for (const role of ROLES) {
      if (!(role in incoming)) continue
      const raw = incoming[role]
      let value: string | null
      if (raw === null || raw === '') value = null
      else if (typeof raw === 'string' && HEX.test(raw)) value = raw.toLowerCase()
      else return apiError(`Invalid colour for ${role}: ${String(raw)}`, 400)

      const { error } = await supabase.rpc('set_section_text_color', {
        p_section: section,
        p_role: role,
        // The SQL function accepts null (clears the role → coded default); the
        // generated arg type is over-strict, so cast.
        p_value: value as string,
      })
      if (error) return apiError(error.message)
    }
  }

  const { data } = await supabase
    .from('homepage_section_styles')
    .select('*')
    .eq('section_key', section)
    .maybeSingle()

  // Flush the cached homepage for every locale so the change is immediately visible.
  for (const locale of locales) revalidatePath(`/${locale}`)

  return apiOk(data ?? { section_key: section, background: null, text_colors: {} })
}
