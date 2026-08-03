import { describe, it, expect, vi, beforeEach } from 'vitest'
import { describeCustomerTypes } from './customer-type-name'

// Mock the FareHarbor client — describeCustomerTypes reads one availability detail.
const getAvailabilityDetail = vi.fn()
vi.mock('./client', () => ({
  getFareHarborClient: () => ({ getAvailabilityDetail }),
}))

const DETAIL = {
  customer_type_rates: [
    { pk: 8689978400, customer_type: { singular: 'Diana - 2 Hours' } },
    { pk: 111, customer_type: { singular: 'Adult' } },
    { pk: 222, customer_type: { singular: 'Child' } },
  ],
}

beforeEach(() => {
  getAvailabilityDetail.mockReset()
  getAvailabilityDetail.mockResolvedValue(DETAIL)
})

describe('describeCustomerTypes', () => {
  it('resolves a single customer type name', async () => {
    const label = await describeCustomerTypes(1, { customerTypeRatePk: 8689978400 })
    expect(label).toBe('Diana - 2 Hours')
  })

  it('formats a mixed shared booking with counts', async () => {
    const label = await describeCustomerTypes(1, {
      customerTypeRates: [
        { pk: 111, count: 2 },
        { pk: 222, count: 1 },
      ],
    })
    expect(label).toBe('2× Adult · 1× Child')
  })

  it('multi-rate takes precedence over a single rate pk', async () => {
    const label = await describeCustomerTypes(1, {
      customerTypeRatePk: 8689978400,
      customerTypeRates: [{ pk: 111, count: 3 }],
    })
    expect(label).toBe('3× Adult')
  })

  it('ignores zero-count entries', async () => {
    const label = await describeCustomerTypes(1, {
      customerTypeRates: [
        { pk: 111, count: 2 },
        { pk: 222, count: 0 },
      ],
    })
    expect(label).toBe('2× Adult')
  })

  it('falls back to #pk when a rate name is unknown', async () => {
    const label = await describeCustomerTypes(1, {
      customerTypeRates: [{ pk: 999, count: 4 }],
    })
    expect(label).toBe('4× #999')
  })

  it('returns null when the single rate pk is not found', async () => {
    const label = await describeCustomerTypes(1, { customerTypeRatePk: 999 })
    expect(label).toBeNull()
  })

  it('returns null when nothing is selected', async () => {
    const label = await describeCustomerTypes(1, {})
    expect(label).toBeNull()
  })

  it('returns null (never throws) when the FareHarbor lookup fails', async () => {
    getAvailabilityDetail.mockRejectedValue(new Error('network'))
    const label = await describeCustomerTypes(1, { customerTypeRatePk: 8689978400 })
    expect(label).toBeNull()
  })
})
