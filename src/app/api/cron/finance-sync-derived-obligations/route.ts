import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { syncAllDerivedObligations } from '@/lib/finance/cockpit/derived/sync-all'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/finance-sync-derived-obligations — nightly.
 * Synchronizes city tax, BTW, standing charges, and partner commissions.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { checked, created, updated } = await syncAllDerivedObligations(supabase, 'cron')

    if (created > 0 || updated > 0) {
      const lines = [`🧭 *Afgeleide verplichtingen gesynchroniseerd* (toeristenbelasting, BTW, vaste lasten, partnercommissies)`]
      if (created > 0) lines.push(`• ${created} nieuw`)
      if (updated > 0) lines.push(`• ${updated} bijgewerkt`)
      await postSlackOps(lines.join('\n'))
    }

    return NextResponse.json({ ok: true, checked, created, updated })
  } catch (err) {
    await alertCronFailure('finance-sync-derived-obligations', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
