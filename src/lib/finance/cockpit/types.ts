import type { ISODate } from './dates'
import type { Insight } from './insights'

// ── Settings ─────────────────────────────────────────────────────────────────

export type Horizon = '30d' | '3m' | '12m'

export const HORIZON_LABELS: Record<Horizon, string> = {
  '30d': 'komende 30 dagen',
  '3m': 'komende 3 maanden',
  '12m': 'komende 12 maanden',
}

export type BucketKey = 'obligations' | 'operational' | 'owner_salary' | 'goals'

export const DEFAULT_PRIORITY: BucketKey[] = ['obligations', 'operational', 'owner_salary', 'goals']

export const BUCKET_LABELS: Record<BucketKey, string> = {
  obligations: 'Verplichtingen',
  operational: 'Operationeel',
  owner_salary: 'Eigenaarssalaris',
  goals: 'Doelen',
}

// ── Obligations ──────────────────────────────────────────────────────────────

export type ObligationKind = 'tax' | 'loan' | 'insurance' | 'berth' | 'salary' | 'crew' | 'contract' | 'invoice' | 'other'

export const OBLIGATION_KIND_LABELS: Record<ObligationKind, string> = {
  tax: 'Belasting',
  loan: 'Lening',
  insurance: 'Verzekering',
  berth: 'Ligplaats',
  salary: 'Salaris',
  crew: 'Bemanning',
  contract: 'Contract',
  invoice: 'Factuur',
  other: 'Overig',
}

/** A row from finance_obligations (only the fields the engine needs). */
export interface ObligationRow {
  id: string
  title: string
  kind: ObligationKind
  amountCents: number
  dueDate: ISODate
  recurrenceMonths: 1 | 3 | 6 | 12 | null
  recurrenceUntil: ISODate | null
  status: 'open' | 'paid' | 'cancelled'
  boatId?: string | null
  /** 'vat:2026-08', 'skipper-hours:2026-08:<staffId>', … for a derived row; null for one Beer typed by hand. Used by categories.ts to tell BTW apart from toeristenbelasting. */
  sourceKey?: string | null
}

/** A row from finance_loan_payments joined with its loan name. */
export interface LoanPaymentRow {
  id: string
  loanId: string
  loanName: string
  dueDate: ISODate
  interestCents: number
  principalCents: number
  totalCents: number
  isPaid: boolean
}

/** One dated amount inside the planning horizon. What the dashboard lists under "Komende verplichtingen". */
export interface ObligationOccurrence {
  key: string
  title: string
  kind: ObligationKind
  amountCents: number
  dueDate: ISODate
  source: 'obligation' | 'loan'
  sourceId: string
  /** Due before today and still open. */
  overdue: boolean
  boatId?: string | null
  /** Carried through from ObligationRow.sourceKey; null for a loan payment (kind is enough to categorise those) or a manually entered obligation. */
  sourceKey?: string | null
}

// ── Goals ────────────────────────────────────────────────────────────────────

export interface GoalRow {
  id: string
  name: string
  targetCents: number
  fundedCents: number
  deadline: ISODate | null
  priority: number
  monthlyFundingCents: number
  status: 'active' | 'completed' | 'paused'
  createdAt: ISODate
  boatId?: string | null
}

export interface GoalProgress {
  id: string
  name: string
  targetCents: number
  fundedCents: number
  remainingCents: number
  progressPct: number
  /** What a steady plan would have reserved by today; 0 when the goal has no plan. */
  plannedByNowCents: number
  behindCents: number
  monthsLeft: number | null
  onTrack: boolean
}

// ── Cash ─────────────────────────────────────────────────────────────────────

export interface CashInput {
  /** Cleared balance. The only number that ever enters the formula. */
  clearedCents: number
  /** Outgoing transactions Revolut still shows as pending — informational only. */
  pendingOutCents: number
  /** Incoming pending — informational only. */
  pendingInCents: number
  source: 'revolut' | 'manual' | 'none'
  asOf: string | null
}

// ── Engine input / output ────────────────────────────────────────────────────

export interface CockpitInputs {
  today: ISODate
  horizon: Horizon
  cash: CashInput
  /** Already expanded within the horizon (see obligations.ts). */
  obligations: ObligationOccurrence[]
  operationalCoverageCents: number
  ownerSalary: {
    monthlyCents: number
    months: number
    /** The stored buffer. This is what the formula deducts. */
    coverageCents: number
  }
  /** Active goals only. */
  goals: GoalProgress[]
  safetyMarginCents: number
  priority?: BucketKey[]
}

export interface Bucket {
  key: BucketKey
  label: string
  requiredCents: number
  /** How much of the requirement cleared cash actually covers, in priority order. */
  fundedCents: number
  shortfallCents: number
}

export type StatusLevel = 'healthy' | 'attention' | 'tight'

export const STATUS_LABELS: Record<StatusLevel, string> = {
  healthy: 'Financieel gezond',
  attention: 'Let op',
  tight: 'Te krap',
}

export interface WhyLine {
  label: string
  amountCents: number
  /** '-' deduction, '=' subtotal/result, 'info' context line. */
  op: '-' | '=' | 'info' | 'start'
  detail?: string
}

export interface CockpitResult {
  today: ISODate
  horizon: Horizon
  horizonEnd: ISODate
  cash: CashInput
  buckets: Bucket[]
  /** Σ requirements of all buckets. */
  requiredCents: number
  /** Cash not claimed by any bucket (≥ 0). This is the "Vrij" segment of the bar. */
  freeCents: number
  /** cash − Σ requirements. May be negative. */
  financialSpaceCents: number
  safetyMarginCents: number
  /** max(0, financialSpace − safetyMargin) */
  availableForGrowthCents: number
  /** max(0, safetyMargin − financialSpace) — shown only when > 0. */
  marginShortfallCents: number
  /** max(0, Σ requirements − cash) — reserves exceed real cash. */
  reserveOverrunCents: number
  ownerSalary: {
    monthlyCents: number
    targetMonths: number
    targetCents: number
    coverageCents: number
    monthsCovered: number
  }
  obligations: ObligationOccurrence[]
  goals: GoalProgress[]
  status: { level: StatusLevel; label: string; reasons: string[] }
  why: WhyLine[]
  /**
   * "Wat vraagt aandacht?" (insights.ts's buildInsights). Optional and never
   * set by computeCockpit() itself — the pure engine has no idea about sync
   * status, unreviewed transactions or missing invoices. load-cockpit.ts's
   * loadCockpit() attaches it as a post-processing step for the dashboard;
   * every other caller of computeCockpit() (loan-impact modal, investment
   * scenario) leaves it unset, which is fine since those never render it.
   */
  insights?: Insight[]
}
