import { describe, it, expect, vi } from 'vitest'
import { createSupabaseChainMock, opArg } from '@/test/supabase-chain-mock'
import { createSinglePaymentDraft, ensureRevolutCounterparty, validateSupplierForDraft } from './draft-payment'

const SUPPLIER = { id: 'sup-1', name: 'Jachthaven Westerdok', iban: 'NL91ABNA0417164300', revolut_counterparty_id: null }

describe('validateSupplierForDraft', () => {
  it('a valid IBAN passes, normalised', () => {
    expect(validateSupplierForDraft({ ...SUPPLIER, iban: 'nl91 abna 0417 1643 00' })).toEqual({ ok: true, iban: 'NL91ABNA0417164300' })
  })
  it('no supplier, no IBAN, and a bad checksum are three distinct refusals', () => {
    expect(validateSupplierForDraft(null)).toEqual({ ok: false, reason: 'no_supplier' })
    expect(validateSupplierForDraft({ ...SUPPLIER, iban: null })).toEqual({ ok: false, reason: 'no_iban' })
    expect(validateSupplierForDraft({ ...SUPPLIER, iban: 'NL91ABNA0417164301' })).toEqual({ ok: false, reason: 'invalid_iban' })
  })
})

describe('ensureRevolutCounterparty', () => {
  it('creates and persists a counterparty only once; a supplier that already has one is reused with no Revolut call', async () => {
    const createCounterparty = vi.fn().mockResolvedValue({ id: 'cp-1' })
    const mock = createSupabaseChainMock(() => ({ data: null }))
    const id = await ensureRevolutCounterparty(mock.client as never, { createCounterparty }, SUPPLIER, 'NL91ABNA0417164300')
    expect(id).toBe('cp-1')
    expect(createCounterparty).toHaveBeenCalledWith({ company_name: 'Jachthaven Westerdok', bank_country: 'NL', currency: 'EUR', iban: 'NL91ABNA0417164300' })
    expect(opArg(mock.queries, 'finance_suppliers', 'update')).toEqual({ revolut_counterparty_id: 'cp-1' })

    const createCounterparty2 = vi.fn()
    const reused = await ensureRevolutCounterparty(mock.client as never, { createCounterparty: createCounterparty2 }, { ...SUPPLIER, revolut_counterparty_id: 'cp-existing' }, 'NL91ABNA0417164300')
    expect(reused).toBe('cp-existing')
    expect(createCounterparty2).not.toHaveBeenCalled()
  })

  it('a failure to persist the new counterparty id throws — a silent loss here would recreate a duplicate counterparty on retry', async () => {
    const createCounterparty = vi.fn().mockResolvedValue({ id: 'cp-1' })
    const mock = createSupabaseChainMock(() => ({ data: null, error: { message: 'db down' } }))
    await expect(ensureRevolutCounterparty(mock.client as never, { createCounterparty }, SUPPLIER, 'NL91ABNA0417164300')).rejects.toThrow(/could not be recorded/)
  })
})

describe('createSinglePaymentDraft', () => {
  it('builds one payment line in major units, and truncates an over-long reference to 140 chars', async () => {
    const createPaymentDraft = vi.fn().mockResolvedValue({ id: 'draft-1' })
    const id = await createSinglePaymentDraft({ createPaymentDraft }, { accountId: 'acc-1', counterpartyId: 'cp-1', amountCents: 12345, title: 'Factuur', reference: 'x'.repeat(200) })
    expect(id).toBe('draft-1')
    const call = createPaymentDraft.mock.calls[0][0]
    expect(call.payments[0]).toMatchObject({ account_id: 'acc-1', receiver: { counterparty_id: 'cp-1' }, amount: 123.45, currency: 'EUR' })
    expect(call.payments[0].reference).toHaveLength(140)
  })
})
