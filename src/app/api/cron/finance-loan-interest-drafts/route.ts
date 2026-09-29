import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { draftDueLoanInterest, formatInterestDraftSlack } from '@/lib/finance/cockpit/loans/interest-drafts'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/finance-loan-interest-drafts — 06:15 on the 1st–3rd of April and October (vercel.json).
 *
 * Creates a Revolut payment DRAFT for each lender's interest that fell due (1 April / 1 October) and
 * tells Beer in his Slack DM. Beer approves the drafts in the Revolut app — nothing here moves money.
 *
 * Runs three days in a row on purpose: it is idempotent (a period with a draft is skipped), so days 2
 * and 3 only retry what failed or was missing an IBAN, and repeat the reminder until it is fixed.
 *
 * `?dryRun=1` reports what would be drafted (and the Slack text) without calling Revolut or writing.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1'

  try {
    const supabase = createAdminClient()
    const today = todayISO()

    if (dryRun) {
      const outcomes = await draftDueLoanInterest(supabase, null, { today, dryRun: true })
      return NextResponse.json({ ok: true, dryRun: true, outcomes, slack: formatInterestDraftSlack(outcomes) })
    }

    const connection = await loadConnection(supabase)
    if (!isConnected(connection) || !connection.account_id) {
      await postSlackOps('⚠️ Rente-concepten niet gemaakt: Revolut is niet gekoppeld (of er is geen rekening gekozen). Verbind Revolut en draai de cron opnieuw.')
      return NextResponse.json({ ok: false, error: 'revolut_not_connected' }, { status: 200 })
    }

    const client = await createRevolutClient(supabase)
    const outcomes = await draftDueLoanInterest(supabase, client, { today, accountId: connection.account_id })

    const text = formatInterestDraftSlack(outcomes)
    if (text) await postSlackOps(text)

    return NextResponse.json({ ok: true, outcomes })
  } catch (err) {
    await alertCronFailure('finance-loan-interest-drafts', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
