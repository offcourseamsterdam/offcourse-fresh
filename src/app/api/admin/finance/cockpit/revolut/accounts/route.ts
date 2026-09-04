import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { toCents } from '@/lib/revolut/client'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'

export const dynamic = 'force-dynamic'

/** GET: live list of Revolut accounts (for the "which account is cash?" picker). */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const row = await loadConnection(supabase)
    if (!isConnected(row)) return apiError('Revolut is niet gekoppeld', 400)
    const client = await createRevolutClient(supabase)
    const accounts = await client.getAccounts()
    return apiOk({
      selectedAccountId: row.account_id,
      accounts: accounts.map(a => ({ id: a.id, name: a.name ?? null, currency: a.currency, state: a.state, accountType: a.account_type ?? null, balanceCents: toCents(a.balance) })),
    })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}

/** PUT { account_id }: choose the account whose balance is "cash". Takes a fresh snapshot. */
export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json().catch(() => null)) as { account_id?: string } | null
    if (!body?.account_id || typeof body.account_id !== 'string') return apiError('account_id is verplicht', 400)
    const supabase = createAdminClient()
    const row = await loadConnection(supabase)
    if (!isConnected(row)) return apiError('Revolut is niet gekoppeld', 400)
    const client = await createRevolutClient(supabase)
    const account = await client.getAccount(body.account_id)
    if (account.currency !== 'EUR') return apiError('Alleen een EUR-rekening kan als cash gelden', 400)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('revolut_connection')
      .update({ account_id: account.id, account_name: account.name ?? null, updated_at: now })
      .eq('id', 'default')
    if (error) return apiError(error.message, 500)
    await supabase.from('revolut_balance_snapshots').insert({ taken_at: now, account_id: account.id, balance_cents: toCents(account.balance), currency: 'EUR', source: 'manual' })
    await logFinanceEvent(supabase, { event_type: 'revolut_account_selected', actor: 'user', entity_type: 'revolut', entity_id: null, payload: { account_id: account.id, name: account.name ?? null } })
    return apiOk({ accountId: account.id, accountName: account.name ?? null, balanceCents: toCents(account.balance) })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
