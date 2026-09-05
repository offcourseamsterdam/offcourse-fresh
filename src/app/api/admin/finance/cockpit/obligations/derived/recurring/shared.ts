/**
 * Shared loader for the recurring-charges derived-obligation route (GET/POST)
 * and the nightly auto-sync cron. Not a route file itself — see city-tax's
 * sibling shared.ts for why this can't just be exported from route.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { RecurringInput } from '@/lib/finance/cockpit/derived/recurring'

type Admin = SupabaseClient<Database>

export interface RecurringLoadResult {
  inputs: RecurringInput[]
  /** Obligation titles that already exist — detectRecurring() excludes any label matching one, so nothing is proposed twice. */
  existingLabels: string[]
}

export async function loadRecurringInputs(supabase: Admin, since: string): Promise<RecurringLoadResult> {
  const { data: txRows, error } = await supabase
    .from('bank_transactions')
    .select('id, amount_cents, created_at, merchant, counterparty, description, category, subcategory')
    .lt('amount_cents', 0)
    .eq('state', 'completed')
    .gte('created_at', since)
  if (error) throw new Error(error.message)

  const inputs: RecurringInput[] = (txRows ?? []).flatMap(r => {
    const merchant = r.merchant as { name?: string } | null
    const counterparty = r.counterparty as { name?: string } | null
    const label = merchant?.name ?? counterparty?.name ?? r.description
    if (!label) return []
    return [{
      id: r.id,
      label,
      date: (r.created_at as string).slice(0, 10),
      amountCents: Math.abs(r.amount_cents),
      category: r.category,
      subcategory: r.subcategory,
    }]
  })

  const { data: obligationRows, error: obligationsErr } = await supabase.from('finance_obligations').select('title')
  if (obligationsErr) throw new Error(obligationsErr.message)

  return { inputs, existingLabels: (obligationRows ?? []).map(o => o.title) }
}
