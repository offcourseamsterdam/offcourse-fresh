import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { Database } from '@/lib/supabase/types'

vi.mock('server-only', () => ({}))

import { classifyAndApply, toClassifiable, type ApplyOptions } from './apply'
import type { RuleContext } from './rules'
import type { AllocationChange } from './allocation-effect'

type Row = Database['public']['Tables']['bank_transactions']['Row']

const TX_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'

const row = (o: Partial<Row> = {}): Row => ({
  id: TX_ID, revolut_id: 'rev-1', request_id: null, type: 'transfer', state: 'completed',
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T10:00:00Z',
  account_id: 'acc', amount_cents: -300_000, fee_cents: 0, currency: 'EUR', balance_after_cents: null,
  reference: null, description: 'To Beer Zoomers', counterparty: null, merchant: null, raw: {},
  category: null, subcategory: null, boat_id: null, goal_id: null, obligation_id: null,
  loan_payment_id: null, invoice_id: null, classified_by: null, confidence: null,
  classification_reason: null, needs_review: false, reviewed_at: null, vat_cents: null,
  first_seen_at: '2026-09-01T10:00:00Z', last_synced_at: '2026-09-01T10:00:00Z',
  allocation_applied: null, allocation_applied_at: null,
  ...o,
} as Row)

const ctx = (o: Partial<RuleContext> = {}): Awaited<ReturnType<typeof import('./apply').loadRuleContext>> => ({
  today: '2026-09-04',
  staff: [{ id: 's1', name: 'Beer Zoomers', role: 'owner' }],
  loanPayments: [],
  obligations: [],
  learnedRules: [],
  ownAccountNames: [],
  boats: [],
  corrections: [],
  ...o,
})

/** Supabase double: settings has a €9.000 salary buffer, one active goal. */
function db(over: { salaryCoverage?: number; goalFunded?: number; goalStatus?: string } = {}) {
  const salaryCoverage = over.salaryCoverage ?? 900_000
  const goalFunded = over.goalFunded ?? 640_000
  const goalStatus = over.goalStatus ?? 'active'
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_settings') return { data: { owner_salary_coverage_cents: salaryCoverage } }
    if (q.table === 'finance_goals') return { data: [{ id: GOAL_ID, name: "Nieuwe accu's", target_cents: 1_000_000, funded_cents: goalFunded, status: goalStatus }] }
    if (q.table === 'finance_obligations') return { data: [] }
    if (q.table === 'finance_loan_payments') return { data: [] }
    return { data: null }
  })
}

const updates = (queries: RecordedQuery[], table: string) =>
  queries.filter(q => q.table === table && has(q, 'update')).map(q => op(q, 'update')!.args[0] as Record<string, unknown>)

describe('classifyAndApply — first classification', () => {
  let mock: ReturnType<typeof db>
  beforeEach(() => { mock = db() })

  it('applies the salary drawdown once and records what it did on the row', async () => {
    const out = await classifyAndApply(mock.client, row(), ctx())
    expect(out.classification).toMatchObject({ category: 'owner', subcategory: 'salary' })
    expect(out.changes).toHaveLength(1)
    expect(out.reversed).toBe(0)

    expect(updates(mock.queries, 'finance_settings')[0]).toMatchObject({ owner_salary_coverage_cents: 600_000 })
    const txUpdate = updates(mock.queries, 'bank_transactions').at(-1)!
    expect(txUpdate).toMatchObject({ category: 'owner', subcategory: 'salary', classified_by: 'rule' })
    expect(txUpdate.allocation_applied).toHaveLength(1)
    expect(txUpdate.allocation_applied_at).toEqual(expect.any(String))
  })

  it('leaves a transaction that is not completed out of the plan entirely', async () => {
    const out = await classifyAndApply(mock.client, row({ state: 'pending' }), ctx())
    expect(out.changes).toEqual([])
    expect(updates(mock.queries, 'finance_settings')).toEqual([])
    expect(updates(mock.queries, 'bank_transactions').at(-1)!.allocation_applied).toBeNull()
  })

  it('marks a transaction it cannot place for review instead of guessing', async () => {
    const out = await classifyAndApply(mock.client, row({ description: 'To Iets Onbekends' }), ctx(), { skipAi: true })
    expect(out.classification).toBeNull()
    expect(out.needsReview).toBe(true)
    expect(updates(mock.queries, 'bank_transactions')[0]).toEqual({ needs_review: true })
  })
})

describe('classifyAndApply — the AI layer and its thresholds', () => {
  const unknown = row({ description: 'To Marinaio', amount_cents: -4380 })
  const ai = (confidence: number): ApplyOptions['aiOverride'] =>
    vi.fn().mockResolvedValue({ category: 'operating', subcategory: 'catering', confidence, reason: 'Horeca', source: 'ai' })

  it('stores a confident answer as fact', async () => {
    const mock = db()
    const out = await classifyAndApply(mock.client, unknown, ctx(), { aiOverride: ai(0.95) })
    expect(out.needsReview).toBe(false)
    expect(updates(mock.queries, 'bank_transactions').at(-1)).toMatchObject({ classified_by: 'ai', needs_review: false })
  })

  it('stores a middling answer but asks a human to look', async () => {
    const mock = db()
    const out = await classifyAndApply(mock.client, unknown, ctx(), { aiOverride: ai(0.7) })
    expect(out.needsReview).toBe(true)
    expect(updates(mock.queries, 'bank_transactions').at(-1)).toMatchObject({ category: 'operating', needs_review: true })
  })

  it('discards an unsure answer rather than filing it', async () => {
    const mock = db()
    const out = await classifyAndApply(mock.client, unknown, ctx(), { aiOverride: ai(0.3) })
    expect(out.classification).toBeNull()
    expect(updates(mock.queries, 'bank_transactions')[0]).toEqual({ needs_review: true })
  })

  it('is never asked when a rule already decided', async () => {
    const mock = db()
    const aiSpy = ai(0.99)
    await classifyAndApply(mock.client, row(), ctx(), { aiOverride: aiSpy })
    expect(aiSpy).not.toHaveBeenCalled()
  })
})

describe('classifyAndApply — re-classification never double-counts', () => {
  const alreadyApplied: AllocationChange[] = [
    { kind: 'owner_salary_drawdown', amountCents: 300_000, newCoverageCents: 600_000, reason: 'eerder' },
  ]

  it('restores the salary buffer before applying the new classification', async () => {
    // The buffer already shows the earlier drawdown: €6.000 of the original €9.000.
    const mock = db({ salaryCoverage: 600_000 })
    const out = await classifyAndApply(
      mock.client,
      row({ allocation_applied: alreadyApplied as never, category: 'owner', subcategory: 'salary' }),
      ctx(),
      {
        actor: 'user',
        userClassification: { category: 'operating', subcategory: 'crew', confidence: 1, reason: 'Toch een schipper', source: 'user' },
      },
    )

    expect(out.reversed).toBe(1)
    // First write puts the €3.000 back; the new classification touches no pot.
    expect(updates(mock.queries, 'finance_settings')[0]).toMatchObject({ owner_salary_coverage_cents: 900_000 })
    expect(out.changes).toEqual([])
    const txUpdate = updates(mock.queries, 'bank_transactions').at(-1)!
    expect(txUpdate).toMatchObject({ category: 'operating', subcategory: 'crew', classified_by: 'user' })
    expect(txUpdate.allocation_applied).toBeNull()
  })

  it('reopens a goal that an earlier classification completed', async () => {
    const completed: AllocationChange[] = [
      { kind: 'goal_completed', goalId: GOAL_ID, releasedCents: 640_000, overspendCents: 0, reason: 'eerder' },
    ]
    const mock = db({ goalStatus: 'completed', goalFunded: 640_000 })
    const out = await classifyAndApply(
      mock.client,
      row({ amount_cents: -870_000, allocation_applied: completed as never }),
      ctx(),
      {
        actor: 'user',
        userClassification: { category: 'operating', subcategory: 'other', confidence: 1, reason: 'Niet voor dat doel', source: 'user' },
      },
    )
    expect(out.reversed).toBe(1)
    expect(updates(mock.queries, 'finance_goals')[0]).toMatchObject({ status: 'active', funded_cents: 640_000, completed_at: null })
  })

  it('a user decision outranks the rules', async () => {
    const mock = db()
    const out = await classifyAndApply(mock.client, row(), ctx(), {
      actor: 'user',
      userClassification: { category: 'operating', subcategory: 'marketing', confidence: 1, reason: 'Handmatig', source: 'user' },
    })
    expect(out.classification).toMatchObject({ category: 'operating', subcategory: 'marketing', source: 'user' })
    expect(updates(mock.queries, 'bank_transactions').at(-1)).toMatchObject({ reviewed_at: expect.any(String), needs_review: false })
  })
})

describe('toClassifiable', () => {
  it('lifts the names out of the stored json blobs', () => {
    const c = toClassifiable(row({
      merchant: { name: 'Marqt', category_code: '5411' } as never,
      counterparty: { name: 'Marqt B.V.', account_type: 'external' } as never,
    }))
    expect(c).toMatchObject({ merchantName: 'Marqt', merchantCategoryCode: '5411', counterpartyName: 'Marqt B.V.', counterpartyAccountType: 'external' })
  })
})
