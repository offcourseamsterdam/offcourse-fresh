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

// ── Revolut (phase 2) ────────────────────────────────────────────────────────

export type RevolutEnvironment = 'sandbox' | 'production'

/** GET revolut/status — everything the connect card needs, without touching Revolut. */
export interface RevolutStatus {
  /** REVOLUT_CLIENT_ID + REVOLUT_PRIVATE_KEY (+ redirect URI) present in env. */
  configured: boolean
  environment: RevolutEnvironment
  redirectUri: string | null
  scopes: string[]
  connected: boolean
  consentedAt: string | null
  accountId: string | null
  accountName: string | null
  lastSyncAt: string | null
  lastSyncError: string | null
  webhook: { id: string; url: string | null } | null
  latestBalance: { cents: number; takenAt: string } | null
  /** REVOLUT_TOKEN_KEY present — without it tokens can't be stored encrypted. */
  tokenKeyConfigured: boolean
}

export interface RevolutConnectResponse {
  authorizeUrl: string
  environment: RevolutEnvironment
  redirectUri: string
  scopes: string[]
}

export interface RevolutAccount {
  id: string
  name: string | null
  currency: string
  state: string
  accountType: string | null
  balanceCents: number
}

export interface RevolutAccountsResponse {
  selectedAccountId: string | null
  accounts: RevolutAccount[]
}

export interface RevolutSyncResponse {
  ok: boolean
  accountId?: string
  balanceCents?: number
  fetched: number
  upserted: number
  stateChanges: Array<{ revolutId: string; from: string | null; to: string }>
}

export interface RevolutWebhookResponse {
  id: string
  url: string
  events: string[]
}

/** One row of bank_transactions as GET transactions hands it back (signed cents, in = positive). */
export interface TransactionApiRow {
  id: string
  revolut_id: string
  type: string
  state: string
  created_at: string
  completed_at: string | null
  amount_cents: number
  fee_cents: number
  currency: string
  balance_after_cents: number | null
  reference: string | null
  description: string | null
  counterparty: Record<string, unknown> | null
  merchant: Record<string, unknown> | null
  category: string | null
  subcategory: string | null
  boat_id: string | null
  goal_id: string | null
  obligation_id: string | null
  loan_payment_id: string | null
  invoice_id: string | null
  classified_by: string | null
  confidence: number | null
  classification_reason: string | null
  needs_review: boolean
  reviewed_at: string | null
}

export interface TransactionsResponse {
  transactions: TransactionApiRow[]
  /** created_at cursor for the next page; null when this was the last page. */
  nextBefore: string | null
}

// ── Investments (Phase 5) ────────────────────────────────────────────────────

export type InvestmentType = 'growth' | 'capacity' | 'efficiency' | 'maintenance' | 'upgrade' | 'risk' | 'strategic'
export type InvestmentStatus = 'idea' | 'planned' | 'approved' | 'executed' | 'dropped'

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  growth: 'Groei',
  capacity: 'Capaciteit',
  efficiency: 'Efficiëntie',
  maintenance: 'Onderhoud',
  upgrade: 'Upgrade',
  risk: 'Risico',
  strategic: 'Strategisch',
}

export const INVESTMENT_STATUS_LABELS: Record<InvestmentStatus, string> = {
  idea: 'Idee',
  planned: 'Gepland',
  approved: 'Goedgekeurd',
  executed: 'Uitgevoerd',
  dropped: 'Afgevallen',
}

/** Every axis is a 1–5 judgement, never euros — see the migration's comment. */
export interface InvestmentImpact {
  capacity?: number
  revenue?: number
  savings?: number
  reliability?: number
  lifespan?: number
  risk?: number
  urgency?: number
  confidence?: number
  notes?: string
}

export const IMPACT_AXIS_LABELS: Record<string, string> = {
  capacity: 'Capaciteit',
  revenue: 'Omzet',
  savings: 'Besparing',
  reliability: 'Betrouwbaarheid',
  lifespan: 'Levensduur',
  risk: 'Risico',
  urgency: 'Urgentie',
  confidence: 'Zekerheid',
}

export interface InvestmentApiRow {
  id: string
  title: string
  amount_cents: number
  boat_id: string | null
  type: InvestmentType
  impact: InvestmentImpact
  /** null = niet betrouwbaar te kwantificeren. Never 0 as a stand-in. */
  expected_return_cents: number | null
  status: InvestmentStatus
  executed_transaction_id: string | null
  goal_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InvestmentPayload {
  title: string
  amount_cents: number
  type: InvestmentType
  impact: InvestmentImpact
  boat_id?: string | null
  expected_return_cents?: number | null
  notes?: string | null
}

/** POST investments/scenario — the same computeCockpit, before and after the spend. */
export interface ScenarioResult {
  amountCents: number
  investment: { id: string; title: string; amount_cents: number } | null
  affordable: boolean
  before: CockpitResult
  after: CockpitResult
  delta: {
    financialSpaceCents: number
    availableForGrowthCents: number
    marginShortfallCents: number
  }
}
