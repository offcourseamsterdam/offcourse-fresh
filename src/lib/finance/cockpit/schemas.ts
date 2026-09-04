/**
 * Request validation for /api/admin/finance/cockpit/*.
 *
 * One place for every body shape so a rule ("kind 'loan' is never a manual
 * obligation", "tranches must add up to the principal") lives exactly once.
 * All money is integer cents.
 */

import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { apiError } from '@/lib/api/response'

// ── Primitives ───────────────────────────────────────────────────────────────

export const horizonSchema = z.enum(['30d', '3m', '12m'])
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
const cents = z.number().int('Amounts must be integer cents')
const nonNegCents = cents.min(0, 'Amount cannot be negative')
const positiveCents = cents.min(1, 'Amount must be greater than zero')
const uuid = z.string().uuid()
const timestamp = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'Expected an ISO timestamp')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const bucketKeySchema = z.enum(['obligations', 'operational', 'owner_salary', 'goals'])

export const settingsUpdateSchema = z
  .object({
    planning_horizon: horizonSchema.optional(),
    safety_margin_cents: nonNegCents.optional(),
    operational_coverage_cents: nonNegCents.optional(),
    owner_salary_monthly_cents: nonNegCents.optional(),
    owner_salary_months: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6)]).optional(),
    owner_salary_coverage_cents: nonNegCents.optional(),
    manual_cash_cents: cents.nullable().optional(),
    allocation_priority: z
      .array(bucketKeySchema)
      .length(4, 'allocation_priority must list all four buckets')
      .refine(arr => new Set(arr).size === 4, 'allocation_priority must list each bucket exactly once')
      .optional(),
  })
  .refine(obj => Object.keys(obj).length > 0, 'No settings fields to update')

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>
export const SETTINGS_KEYS = [
  'planning_horizon', 'safety_margin_cents', 'operational_coverage_cents', 'owner_salary_monthly_cents',
  'owner_salary_months', 'owner_salary_coverage_cents', 'manual_cash_cents', 'allocation_priority',
] as const

// ── Obligations ──────────────────────────────────────────────────────────────

export const obligationKindSchema = z.enum(['tax', 'loan', 'insurance', 'berth', 'salary', 'crew', 'contract', 'invoice', 'other'])
export const obligationStatusFilterSchema = z.enum(['open', 'paid', 'cancelled', 'all'])

const obligationFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  kind: obligationKindSchema.refine(k => k !== 'loan', "kind 'loan' is not allowed — loan payments come from the loan schedule"),
  amount_cents: nonNegCents,
  due_date: isoDate,
  recurrence_months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).nullable().optional(),
  recurrence_until: isoDate.nullable().optional(),
  boat_id: uuid.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}
export const obligationCreateSchema = z.object(obligationFields)
export const obligationUpdateSchema = z
  .object(obligationFields)
  .partial()
  .refine(obj => Object.keys(obj).length > 0, 'No obligation fields to update')
export type ObligationCreate = z.infer<typeof obligationCreateSchema>
export type ObligationUpdate = z.infer<typeof obligationUpdateSchema>
export const OBLIGATION_KEYS = Object.keys(obligationFields)

export const markPaidSchema = z.object({
  paid_at: timestamp.optional(),
  paid_transaction_id: uuid.nullable().optional(),
})

// ── Loans ────────────────────────────────────────────────────────────────────

export const repaymentTypeSchema = z.enum(['linear', 'annuity', 'interest_only'])

export const trancheSchema = z.object({
  amount_cents: positiveCents,
  date: isoDate,
  note: z.string().trim().max(500).optional(),
})

const loanFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  lender_name: z.string().trim().min(1, 'Lender name is required').max(200),
  principal_cents: positiveCents,
  interest_rate_pct: z.number().min(0).max(100),
  duration_years: z.number().int().min(1).max(50),
  interest_free_years: z.number().int().min(0).max(50),
  repayment_type: repaymentTypeSchema,
  start_date: isoDate,
  tranches: z.array(trancheSchema).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}

function tranchesMatchPrincipal(obj: { principal_cents?: number; tranches?: Array<{ amount_cents: number }> }): boolean {
  if (!obj.tranches || obj.tranches.length === 0 || obj.principal_cents == null) return true
  return obj.tranches.reduce((s, t) => s + t.amount_cents, 0) === obj.principal_cents
}
const TRANCHE_MSG = 'Tranches must add up to principal_cents'

export const loanCreateSchema = z
  .object(loanFields)
  .refine(o => o.interest_free_years <= o.duration_years, { message: 'interest_free_years cannot exceed duration_years', path: ['interest_free_years'] })
  .refine(tranchesMatchPrincipal, { message: TRANCHE_MSG, path: ['tranches'] })
export const loanUpdateSchema = z
  .object(loanFields)
  .partial()
  .refine(obj => Object.keys(obj).length > 0, 'No loan fields to update')
  .refine(tranchesMatchPrincipal, { message: TRANCHE_MSG, path: ['tranches'] })
export type LoanCreate = z.infer<typeof loanCreateSchema>
export type LoanUpdate = z.infer<typeof loanUpdateSchema>
export const LOAN_KEYS = Object.keys(loanFields)

export const loanImpactSchema = z
  .object({
    ...loanFields,
    proceeds_received: z.boolean().default(true),
    horizon: horizonSchema.optional(),
  })
  .refine(o => o.interest_free_years <= o.duration_years, { message: 'interest_free_years cannot exceed duration_years', path: ['interest_free_years'] })
  .refine(tranchesMatchPrincipal, { message: TRANCHE_MSG, path: ['tranches'] })
export type LoanImpactInput = z.infer<typeof loanImpactSchema>

// ── Goals ────────────────────────────────────────────────────────────────────

export const goalStatusFilterSchema = z.enum(['active', 'completed', 'paused', 'all'])

const goalFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  target_cents: positiveCents,
  funded_cents: nonNegCents,
  deadline: isoDate.nullable().optional(),
  priority: z.number().int().min(1).max(5),
  monthly_funding_cents: nonNegCents,
  boat_id: uuid.nullable().optional(),
  flexibility: z.enum(['fixed', 'flexible']),
}
export const goalCreateSchema = z.object({
  ...goalFields,
  funded_cents: nonNegCents.default(0),
  priority: z.number().int().min(1).max(5).default(3),
  monthly_funding_cents: nonNegCents.default(0),
  flexibility: z.enum(['fixed', 'flexible']).default('flexible'),
})
export const goalUpdateSchema = z
  .object({ ...goalFields, status: z.enum(['active', 'paused']) })
  .partial()
  .refine(obj => Object.keys(obj).length > 0, 'No goal fields to update')
export type GoalCreate = z.infer<typeof goalCreateSchema>
export type GoalUpdate = z.infer<typeof goalUpdateSchema>
export const GOAL_KEYS = [...Object.keys(goalFields), 'status']

export const goalCompleteSchema = z.object({
  completed_transaction_id: uuid.nullable().optional(),
})

// ── Helpers ──────────────────────────────────────────────────────────────────

export function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Invalid input'
  const path = issue.path.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: ReturnType<typeof apiError> }

/** Parses the JSON body against a schema; a malformed or invalid body becomes a 400. */
export async function parseBody<S extends z.ZodTypeAny>(request: NextRequest, schema: S): Promise<Parsed<z.infer<S>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    raw = undefined
  }
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) return { ok: false, response: apiError(zodMessage(parsed.error), 400) }
  return { ok: true, data: parsed.data }
}

/** Parses one query-string value against a schema, falling back to `fallback` when absent. */
export function parseQuery<S extends z.ZodTypeAny>(request: NextRequest, key: string, schema: S, fallback: z.infer<S>): Parsed<z.infer<S>> {
  const raw = request.nextUrl.searchParams.get(key)
  if (raw === null || raw === '') return { ok: true, data: fallback }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, response: apiError(`${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`, 400) }
  return { ok: true, data: parsed.data }
}
