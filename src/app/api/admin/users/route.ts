import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/server'
import { VALID_ROLES } from '@/lib/auth/types'
import type { UserRole } from '@/lib/auth/types'

// GET /api/admin/users — list all user profiles (admin only)
export async function GET() {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return apiError(error.message)
  }

  return apiOk({ users: data })
}

// PATCH /api/admin/users — update role or is_active for a user (admin only)
export async function PATCH(request: NextRequest) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const body = await request.json()
  const { id, role, is_active } = body

  if (!id) {
    return apiError('Missing user id', 400)
  }

  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return apiError('Invalid role', 400)
  }

  const updates: Record<string, unknown> = {}
  if (role !== undefined) updates.role = role
  if (is_active !== undefined) updates.is_active = is_active

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return apiError(error.message)
  }

  return apiOk({ user: data })
}
