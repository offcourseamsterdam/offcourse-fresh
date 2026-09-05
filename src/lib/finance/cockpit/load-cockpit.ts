import 'server-only'

/**
 * The only place that reads the database for the cockpit. Everything after
 * `loadCockpitInputs()` is pure, which is what makes "what if" screens
 * (investment scenario, loan impact) trivial: load inputs once, tweak, recompute.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRevolutCashInput } from '@/lib/revolut/cash'
import { findShiftsMissingInvoices } from '@/lib/finance/invoices/missing'
import { computeCockpit } from './compute'
import { todayISO, type ISODate } from './dates'
import { goalProgress } from './goals'
import { expandObligations } from './obligations'
import { checkReconciliation } from './reconciliation'
import { buildInsights, sortInsights } from './insights'
import type { BucketKey, CashInput, CockpitInputs, CockpitResult, GoalRow, Horizon, LoanPaymentRow, ObligationRow } from './types'

type Admin = SupabaseClient<Database>
export type FinanceSettingsRow = Database['public']['Tables']['finance_settings']['Row']

export interface LoadOptions {
  supabase?: Admin
  /** Overrides the stored planning horizon for this computation only. */
  horizon?: Horizon
  today?: ISODate
  /** Phase 2 supplies the live Revolut balance here; until then the settings' manual balance is used. */
  cash?: CashInput
}

export interface LoadedCockpit {
  inputs: CockpitInputs
  settings: FinanceSettingsRow
}

export async function loadFinanceSettings(supabase: Admin): Promise<FinanceSettingsRow> {
  const { data, error } = await supabase.from('finance_settings').select('*').eq('id', 'default').maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return data
  const { data: created, error: insErr } = await supabase.from('finance_settings').insert({ id: 'default' }).select('*').single()
  if (insErr || !created) throw new Error(insErr?.message ?? 'Could not create finance_settings')
  return created
}

export function cashFromSettings(settings: FinanceSettingsRow): CashInput {
  if (typeof settings.manual_cash_cents === 'number') {
    return { clearedCents: settings.manual_cash_cents, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: settings.manual_cash_at }
  }
  return { clearedCents: 0, pendingOutCents: 0, pendingInCents: 0, source: 'none', asOf: null }
}

export async function loadCockpitInputs(opts: LoadOptions = {}): Promise<LoadedCockpit> {
  const supabase = opts.supabase ?? createAdminClient()
  const today = opts.today ?? todayISO()

  const [settings, obligationsRes, paymentsRes, goalsRes] = await Promise.all([
    loadFinanceSettings(supabase),
    supabase.from('finance_obligations').select('id, title, kind, amount_cents, due_date, recurrence_months, recurrence_until, status, boat_id, source_key').eq('status', 'open'),
    supabase.from('finance_loan_payments').select('id, loan_id, due_date, interest_cents, principal_cents, total_cents, is_paid, finance_loans!inner(name, status)').eq('is_paid', false),
    supabase.from('finance_goals').select('id, name, target_cents, funded_cents, deadline, priority, monthly_funding_cents, status, created_at, boat_id').eq('status', 'active'),
  ])
  if (obligationsRes.error) throw new Error(obligationsRes.error.message)
  if (paymentsRes.error) throw new Error(paymentsRes.error.message)
  if (goalsRes.error) throw new Error(goalsRes.error.message)

  const horizon = (opts.horizon ?? settings.planning_horizon) as Horizon

  const obligationRows: ObligationRow[] = (obligationsRes.data ?? []).map(r => ({
    id: r.id,
    title: r.title,
    kind: r.kind as ObligationRow['kind'],
    amountCents: r.amount_cents,
    dueDate: r.due_date,
    recurrenceMonths: (r.recurrence_months ?? null) as ObligationRow['recurrenceMonths'],
    recurrenceUntil: r.recurrence_until,
    status: r.status as ObligationRow['status'],
    boatId: r.boat_id,
    sourceKey: r.source_key,
  }))

  const loanPayments: LoanPaymentRow[] = (paymentsRes.data ?? [])
    .filter(r => {
      const loan = r.finance_loans as unknown as { name: string; status: string } | null
      return loan?.status === 'active'
    })
    .map(r => {
      const loan = r.finance_loans as unknown as { name: string }
      return {
        id: r.id,
        loanId: r.loan_id,
        loanName: loan.name,
        dueDate: r.due_date,
        interestCents: r.interest_cents,
        principalCents: r.principal_cents,
        totalCents: r.total_cents,
        isPaid: r.is_paid,
      }
    })

  const goalRows: GoalRow[] = (goalsRes.data ?? []).map(r => ({
    id: r.id,
    name: r.name,
    targetCents: r.target_cents,
    fundedCents: r.funded_cents,
    deadline: r.deadline,
    priority: r.priority,
    monthlyFundingCents: r.monthly_funding_cents,
    status: r.status as GoalRow['status'],
    createdAt: r.created_at.slice(0, 10),
    boatId: r.boat_id,
  }))

  // Cash: live Revolut snapshot when connected, else the manual balance from settings.
  const cash = opts.cash ?? (await getRevolutCashInput(supabase)) ?? cashFromSettings(settings)

  const inputs: CockpitInputs = {
    today,
    horizon,
    cash,
    obligations: expandObligations(obligationRows, loanPayments, { today, horizon }),
    operationalCoverageCents: settings.operational_coverage_cents,
    ownerSalary: {
      monthlyCents: settings.owner_salary_monthly_cents,
      months: settings.owner_salary_months,
      coverageCents: settings.owner_salary_coverage_cents,
    },
    goals: goalRows.sort((a, b) => a.priority - b.priority).map(g => goalProgress(g, today)),
    safetyMarginCents: settings.safety_margin_cents,
    priority: Array.isArray(settings.allocation_priority) ? (settings.allocation_priority as BucketKey[]) : undefined,
  }
  return { inputs, settings }
}

/**
 * Everything buildInsights() needs beyond the computed cockpit itself — one
 * more round of DB reads, separate from loadCockpitInputs() because none of
 * this feeds the money formula; it only feeds "what should Beer look at".
 * A failure here must never take down the dashboard the way a failure in
 * the cash/obligations path would, so callers get an empty insight list
 * instead of a thrown error (see loadCockpit()).
 */
export async function loadInsights(supabase: Admin, cockpit: CockpitResult): Promise<import('./insights').Insight[]> {
  const { data: conn } = await supabase
    .from('revolut_connection')
    .select('account_id, last_sync_at, last_sync_error')
    .eq('id', 'default')
    .maybeSingle()

  let reconciliationGapCents = 0
  if (conn?.account_id) {
    const [{ data: snap }, { data: lastTx }] = await Promise.all([
      supabase.from('revolut_balance_snapshots').select('balance_cents').eq('account_id', conn.account_id).order('taken_at', { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from('bank_transactions')
        .select('balance_after_cents')
        .eq('account_id', conn.account_id)
        .eq('state', 'completed')
        .not('balance_after_cents', 'is', null)
        // completed_at is nullable (sync.ts writes it as `tx.completed_at ?? null`),
        // and Postgres sorts NULLS FIRST by default on a DESC order — without this,
        // a completed transaction Revolut never stamped a completion time on would
        // outrank every real one and get picked as "most recent", regardless of how
        // stale it actually is. Same convention already used for every other
        // nullable-date DESC query in this codebase (see e.g. the withlocals/
        // barqo/getmyboat/fareharbor bookings routes).
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (snap) reconciliationGapCents = checkReconciliation(snap.balance_cents, lastTx?.balance_after_cents ?? null).gapCents
  }

  const [{ count: unclassifiedCount }, needsReviewRes, missingCandidates, { count: expenseReviewCount }, { count: expensePartialCount }] = await Promise.all([
    supabase.from('bank_transactions').select('id', { count: 'exact', head: true }).is('classified_by', null),
    // Bounded: nobody needs the 501st unreviewed transaction to compute a count and a "largest" figure.
    supabase.from('bank_transactions').select('amount_cents').eq('needs_review', true).limit(500),
    findShiftsMissingInvoices(supabase, cockpit.today),
    supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).eq('status', 'needs_review'),
    supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).eq('status', 'partially_matched'),
  ])
  const needsReviewRows = needsReviewRes.data ?? []
  const largestUnreviewedCents = needsReviewRows.reduce((max, r) => Math.max(max, Math.abs(r.amount_cents)), 0)

  return sortInsights(
    buildInsights({
      cockpit,
      unclassifiedCount: unclassifiedCount ?? 0,
      needsReviewCount: needsReviewRows.length,
      largestUnreviewedCents,
      reconciliationGapCents,
      syncError: conn?.last_sync_error ?? null,
      lastSyncAt: conn?.last_sync_at ?? null,
      missingInvoiceCount: missingCandidates.filter(c => !c.hasInvoice).length,
      expenseReviewCount: expenseReviewCount ?? 0,
      expensePartialCount: expensePartialCount ?? 0,
    }),
  )
}

export async function loadCockpit(opts: LoadOptions = {}): Promise<CockpitResult> {
  const supabase = opts.supabase ?? createAdminClient()
  const { inputs } = await loadCockpitInputs({ ...opts, supabase })
  const cockpit = computeCockpit(inputs)

  try {
    cockpit.insights = await loadInsights(supabase, cockpit)
  } catch (err) {
    // "Wat vraagt aandacht?" is a nice-to-have on top of an already-correct
    // dashboard — a failure reading, say, bank_transactions must never turn
    // into a broken Financieel overzicht page.
    console.error('[finance/cockpit/load-cockpit] insights failed:', err instanceof Error ? err.message : err)
    cockpit.insights = []
  }

  return cockpit
}
