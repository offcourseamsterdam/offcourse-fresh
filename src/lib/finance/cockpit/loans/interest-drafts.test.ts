import { describe, it, expect, vi } from 'vitest'
import { createSupabaseChainMock, has, opArg } from '@/test/supabase-chain-mock'
import { draftDueLoanInterest, formatDueDateNl, formatInterestDraftSlack, interestReference, type InterestDraftOutcome } from './interest-drafts'

const GOOD_IBAN = 'NL91ABNA0417164300'
const supplier = (over: Record<string, unknown> = {}) => ({ id: 'sup-1', name: 'Tijs Louman', iban: GOOD_IBAN, revolut_counterparty_id: null, ...over })
const payment = (over: Record<string, unknown> = {}, sup: unknown = supplier()) => ({
  id: 'pay-1', loan_id: 'loan-1', due_date: '2026-10-01', interest_cents: 18000, principal_cents: 0,
  finance_loans: { lender_name: 'Tijs Louman', status: 'active', supplier: sup },
  ...over,
})

function setup(rows: unknown[], client: Record<string, unknown> = {}) {
  const mock = createSupabaseChainMock(q => {
    if (q.table === 'finance_loan_payments' && has(q, 'select')) return { data: rows }
    return { data: null }
  })
  const revolut = {
    getCounterparties: vi.fn().mockResolvedValue([]),
    createCounterparty: vi.fn().mockResolvedValue({ id: 'cp-new' }),
    createPaymentDraft: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    ...client,
  }
  return { mock, revolut }
}

describe('formatting', () => {
  it('formats due dates and the payment reference in Dutch', () => {
    expect(formatDueDateNl('2026-10-01')).toBe('1 oktober 2026')
    expect(interestReference('2027-04-01')).toBe('Rente lening per 1 april 2027')
  })
})

describe('draftDueLoanInterest', () => {
  it('drafts ONLY the interest, in the lender\'s reference, and pins the draft id on the period', async () => {
    const { mock, revolut } = setup([payment({ principal_cents: 50000 })])
    const out = await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-01', accountId: 'acc-1' })

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ status: 'drafted', draftId: 'draft-1', interestCents: 18000, principalCents: 50000 })
    const call = revolut.createPaymentDraft.mock.calls[0][0]
    expect(call.payments[0]).toMatchObject({ account_id: 'acc-1', amount: 180, currency: 'EUR', reference: 'Rente lening per 1 oktober 2026' })
    expect(opArg(mock.queries, 'finance_loan_payments', 'update')).toMatchObject({ revolut_draft_id: 'draft-1' })
  })

  it('only asks the database for unpaid, undrafted, interest-bearing periods inside the lookback window', async () => {
    const { mock, revolut } = setup([])
    await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-02', accountId: 'acc-1' })
    const q = mock.queries.find(x => x.table === 'finance_loan_payments')!
    const args = (m: string) => q.ops.filter(o => o.method === m).map(o => o.args)
    expect(args('eq')).toContainEqual(['is_paid', false])
    expect(args('is')).toContainEqual(['revolut_draft_id', null])
    expect(args('gt')).toContainEqual(['interest_cents', 0])
    expect(args('lte')).toContainEqual(['due_date', '2026-10-02'])
    expect(args('gte')).toContainEqual(['due_date', '2026-09-18'])
  })

  it('reuses a counterparty that already exists in Revolut (matched on IBAN) instead of creating a duplicate', async () => {
    const { mock, revolut } = setup([payment()], {
      getCounterparties: vi.fn().mockResolvedValue([{ id: 'cp-existing', accounts: [{ iban: 'nl91 abna 0417 1643 00' }] }]),
    })
    await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-01', accountId: 'acc-1' })
    expect(revolut.createCounterparty).not.toHaveBeenCalled()
    expect(revolut.createPaymentDraft.mock.calls[0][0].payments[0].receiver.counterparty_id).toBe('cp-existing')
    expect(opArg(mock.queries, 'finance_suppliers', 'update')).toEqual({ revolut_counterparty_id: 'cp-existing' })
  })

  it('creates the counterparty when neither the supplier nor Revolut knows it', async () => {
    const { mock, revolut } = setup([payment()])
    await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-01', accountId: 'acc-1' })
    expect(revolut.createCounterparty).toHaveBeenCalledOnce()
    expect(revolut.createPaymentDraft.mock.calls[0][0].payments[0].receiver.counterparty_id).toBe('cp-new')
  })

  it('a lender without a payee, or without / with a bad IBAN, is skipped with a reason and never reaches Revolut', async () => {
    const { mock, revolut } = setup([
      payment({ id: 'a' }, null),
      payment({ id: 'b' }, supplier({ iban: null })),
      payment({ id: 'c' }, supplier({ iban: 'NL91ABNA0417164301' })),
    ])
    const out = await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-01', accountId: 'acc-1' })
    expect(out.map(o => o.status)).toEqual(['skipped', 'skipped', 'skipped'])
    expect(out[0].reason).toMatch(/gekoppeld/)
    expect(out[1].reason).toMatch(/geen IBAN/)
    expect(out[2].reason).toMatch(/klopt niet/)
    expect(revolut.createPaymentDraft).not.toHaveBeenCalled()
  })

  it('one lender failing does not stop the others', async () => {
    const { mock, revolut } = setup([payment({ id: 'a' }), payment({ id: 'b' })], {
      createPaymentDraft: vi.fn().mockRejectedValueOnce(new Error('Revolut 500')).mockResolvedValueOnce({ id: 'draft-2' }),
    })
    const out = await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-01', accountId: 'acc-1' })
    expect(out.map(o => o.status)).toEqual(['failed', 'drafted'])
    expect(out[0].reason).toBe('Revolut 500')
  })

  it('a closed loan is never drafted', async () => {
    const closed = payment()
    closed.finance_loans.status = 'closed'
    const { mock, revolut } = setup([closed])
    expect(await draftDueLoanInterest(mock.client, revolut as never, { today: '2026-10-01', accountId: 'acc-1' })).toEqual([])
  })

  it('dry run reports what would happen and touches neither Revolut nor the database', async () => {
    const { mock } = setup([payment()])
    const out = await draftDueLoanInterest(mock.client, null, { today: '2026-10-01', dryRun: true })
    expect(out[0].status).toBe('would_draft')
    expect(mock.queries.every(q => !has(q, 'update') && !has(q, 'insert'))).toBe(true)
  })

  it('a live run without a Revolut client or account refuses up front', async () => {
    const { mock } = setup([])
    await expect(draftDueLoanInterest(mock.client, null, { today: '2026-10-01' })).rejects.toThrow(/required/)
  })
})

describe('formatInterestDraftSlack', () => {
  const o = (over: Partial<InterestDraftOutcome>): InterestDraftOutcome => ({
    paymentId: 'p', loanId: 'l', lender: 'Tijs Louman', dueDate: '2026-10-01', interestCents: 18000, principalCents: 0, status: 'drafted', ...over,
  })

  it('returns null when there is nothing to say', () => {
    expect(formatInterestDraftSlack([])).toBeNull()
  })

  it('lists each draft with the total, and separately what needs manual attention', () => {
    const text = formatInterestDraftSlack([
      o({ lender: 'Tijs Louman', interestCents: 18000 }),
      o({ lender: 'Irma Blackmore', interestCents: 90000 }),
      o({ lender: 'Erik Musegaas', interestCents: 249375, status: 'skipped', reason: 'deze lener heeft nog geen IBAN' }),
    ])!
    expect(text).toContain('2 concepten staan klaar')
    expect(text).toContain('Tijs Louman')
    expect(text).toMatch(/Totaal: €\s?1\.080,00/)
    expect(text).toContain('Niet klaargezet')
    expect(text).toContain('Erik Musegaas')
    expect(text).toContain('geen IBAN')
  })

  it('warns when principal falls in the same period but is not in the draft', () => {
    expect(formatInterestDraftSlack([o({ principalCents: 50000 })])).toMatch(/aflossing valt ook in deze periode/)
  })
})
