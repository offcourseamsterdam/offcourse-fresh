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
import { computeCockpit } from './compute'
import { todayISO, type ISODate } from './dates'
import { goalProgress } from './goals'
import { expandObligations } from './obligations'
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
    supabase.from('finance_obligations').select('id, title, kind, amount_cents, due_date, recurrence_months, recurrence_until, status, boat_id').eq('status', 'open'),
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

export async function loadCockpit(opts: LoadOptions = {}): Promise<CockpitResult> {
  const { inputs } = await loadCockpitInputs(opts)
  return computeCockpit(inputs)
}
