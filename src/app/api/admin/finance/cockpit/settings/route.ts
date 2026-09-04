import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadFinanceSettings } from '@/lib/finance/cockpit/load-cockpit'
import { diffChanges, logFinanceEvent } from '@/lib/finance/cockpit/events'
import { SETTINGS_KEYS, parseBody, settingsUpdateSchema } from '@/lib/finance/cockpit/schemas'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

type SettingsUpdateRow = Database['public']['Tables']['finance_settings']['Update']

/** GET /api/admin/finance/cockpit/settings — the single finance_settings row (created on first read). */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    return apiOk(await loadFinanceSettings(createAdminClient()))
  } catch (err) {
    console.error('[finance/cockpit/settings GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load settings', 500)
  }
}

/**
 * PUT /api/admin/finance/cockpit/settings — partial update.
 * Setting manual_cash_cents also stamps manual_cash_at (null clears both).
 * Every change is logged as a 'settings_updated' event with before/after.
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, settingsUpdateSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const before = await loadFinanceSettings(supabase)
    const now = new Date().toISOString()

    const update: SettingsUpdateRow = { ...parsed.data, updated_at: now }
    if ('manual_cash_cents' in parsed.data) {
      update.manual_cash_at = parsed.data.manual_cash_cents === null ? null : now
    }

    const { data: after, error } = await supabase
      .from('finance_settings')
      .update(update)
      .eq('id', 'default')
      .select('*')
      .single()
    if (error || !after) return apiError(error?.message ?? 'Could not update settings', 500)

    const diff = diffChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, SETTINGS_KEYS)
    const coverageChanged = diff.changed.includes('owner_salary_coverage_cents')
    await logFinanceEvent(supabase, {
      event_type: 'settings_updated',
      actor: 'user',
      entity_type: 'settings',
      entity_id: null,
      delta_cents: coverageChanged ? after.owner_salary_coverage_cents - before.owner_salary_coverage_cents : null,
      payload: diff,
    })

    return apiOk(after)
  } catch (err) {
    console.error('[finance/cockpit/settings PUT]', err)
    return apiError(err instanceof Error ? err.message : 'Could not update settings', 500)
  }
}
