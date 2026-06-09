import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/admin/homepage-styles — all section style rows (for the admin editor).
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('homepage_section_styles').select('*')
  if (error) return apiError(error.message)
  return apiOk({ styles: data ?? [] })
}
