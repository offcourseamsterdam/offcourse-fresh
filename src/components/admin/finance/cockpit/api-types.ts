/**
 * Client-side shapes of what /api/admin/finance/cockpit/* returns.
 *
 * The engine types (CockpitResult, GoalProgress, …) come straight from
 * src/lib/finance/cockpit/types.ts. The rows below mirror the Supabase
 * columns (snake_case) that the CRUD routes hand back unchanged.
 */
import type { CockpitResult, BucketKey, GoalProgress, Horizon, ObligationKind } from '@/lib/finance/cockpit/types'
import type { SchedulePeriod } from '@/lib/finance/cockpit/loans/schedule'

export const COCKPIT_API = '/api/admin/finance/cockpit'

export interface SettingsRow {
  id: string
  planning_horizon: Horizon
  safety_margin_cents: number
  operational_coverage_cents: number
  owner_salary_monthly_cents: number
  owner_salary_months: number
  owner_salary_coverage_cents: number
  manual_cash_cents: number | null
  manual_cash_at: string | null
  allocation_priority: BucketKey[]
  updated_at: string
}

/** Body of PUT settings — everything editable, sent as one object. */
export interface SettingsPayload {
  planning_horizon: Horizon
  safety_margin_cents: number
  operational_coverage_cents: number
  owner_salary_monthly_cents: number
  owner_salary_months: number
  owner_salary_coverage_cents: number
  manual_cash_cents: number | null
  allocation_priority: BucketKey[]
}

export type ObligationStatus = 'open' | 'paid' | 'cancelled'

export interface ObligationApiRow {
  id: string
  title: string
  kind: ObligationKind
  amount_cents: number
  due_date: string
  recurrence_months: number | null
  recurrence_until: string | null
  boat_id: string | null
  status: ObligationStatus
  paid_at: string | null
  notes: string | null
}

export interface ObligationPayload {
  title: string
  kind: ObligationKind
  amount_cents: number
  due_date: string
  recurrence_months?: number | null
  recurrence_until?: string | null
  boat_id?: string | null
  notes?: string | null
}

export type RepaymentType = 'linear' | 'annuity' | 'interest_only'

export const REPAYMENT_TYPE_LABELS: Record<RepaymentType, string> = {
  linear: 'Lineair',
  annuity: 'Annuïteit',
  interest_only: 'Aflossingsvrij',
}

export interface LoanTranchePayload {
  amount_cents: number
  date: string
  note?: string
}

export interface LoanSummary {
  outstandingCents: number
  nextPayment: { due_date: string; total_cents: number } | null
  paidPeriods: number
  totalPeriods: number
  totalInterestCents: number
}

export interface LoanApiRow {
  id: string
  name: string
  lender_name: string
  principal_cents: number
  interest_rate_pct: number
  duration_years: number
  interest_free_years: number
  repayment_type: RepaymentType
  start_date: string
  tranches: LoanTranchePayload[] | null
  status: 'active' | 'closed'
  notes: string | null
  summary: LoanSummary
}

export interface LoanPayload {
  name: string
  lender_name: string
  principal_cents: number
  interest_rate_pct: number
  duration_years: number
  interest_free_years: number
  repayment_type: RepaymentType
  start_date: string
  tranches?: LoanTranchePayload[]
  notes?: string | null
}

export interface LoanPaymentApiRow {
  id: string
  due_date: string
  interest_cents: number
  principal_cents: number
  total_cents: number
  is_paid: boolean
  paid_at: string | null
}

export interface LoanDetail {
  loan: Omit<LoanApiRow, 'summary'> & { summary?: LoanSummary }
  payments: LoanPaymentApiRow[]
}

export interface LoanImpactResult {
  before: CockpitResult
  after: CockpitResult
  schedulePreview: SchedulePeriod[]
  endDate: string
  totalInterestCents: number
  obligationsAddedInHorizonCents: number
  belowSafetyMargin: boolean
}

export type GoalStatus = 'active' | 'completed' | 'paused'
export type GoalFlexibility = 'fixed' | 'flexible'

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Actief',
  completed: 'Voltooid',
  paused: 'Gepauzeerd',
}

export const GOAL_FLEXIBILITY_LABELS: Record<GoalFlexibility, string> = {
  fixed: 'Vast',
  flexible: 'Flexibel',
}

export interface GoalApiRow {
  id: string
  name: string
  description: string | null
  target_cents: number
  funded_cents: number
  deadline: string | null
  priority: number
  monthly_funding_cents: number
  boat_id: string | null
  status: GoalStatus
  flexibility: GoalFlexibility
  completed_at: string | null
  created_at: string
  progress: GoalProgress
}

export interface GoalPayload {
  name: string
  description?: string | null
  target_cents: number
  funded_cents?: number
  deadline?: string | null
  priority?: number
  monthly_funding_cents?: number
  boat_id?: string | null
  flexibility?: GoalFlexibility
}

export interface FinanceEventRow {
  id: string
  occurred_at: string
  event_type: string
  actor: 'user' | 'cron' | 'ai' | 'webhook'
  delta_cents: number | null
  payload: Record<string, unknown> | null
}

export interface BoatOption {
  id: string
  name: string
}
