import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { allocateInvoiceNumber } from './allocate-invoice-number'

type MockRpcResult = { data: unknown; error: { message: string } | null }

function mockClient(result: MockRpcResult) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)
  return { rpc }
}

describe('allocateInvoiceNumber', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the formatted invoice number on success', async () => {
    const { rpc } = mockClient({ data: 'OC-2026-00001', error: null })
    const result = await allocateInvoiceNumber('pi_abc123')
    expect(result).toBe('OC-2026-00001')
    expect(rpc).toHaveBeenCalledWith('allocate_invoice_number', { p_stripe_pi_id: 'pi_abc123' })
  })

  it('passes the exact PI id to the RPC', async () => {
    const { rpc } = mockClient({ data: 'OC-2026-00007', error: null })
    await allocateInvoiceNumber('pi_3TmpEZGh1qCF71Ta15j4WcIs')
    expect(rpc).toHaveBeenCalledWith('allocate_invoice_number', {
      p_stripe_pi_id: 'pi_3TmpEZGh1qCF71Ta15j4WcIs',
    })
  })

  // ── Sequential allocation ─────────────────────────────────────────────────
  // The DB guarantees sequential, non-repeating values via nextval(). These
  // tests verify that the TS wrapper correctly threads distinct return values
  // through and does not collapse or deduplicate them.

  it('returns different numbers for different PIs (sequential allocation)', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 'OC-2026-00001', error: null })
      .mockResolvedValueOnce({ data: 'OC-2026-00002', error: null })
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)

    const first  = await allocateInvoiceNumber('pi_first')
    const second = await allocateInvoiceNumber('pi_second')
    expect(first).toBe('OC-2026-00001')
    expect(second).toBe('OC-2026-00002')
    expect(first).not.toBe(second)
  })

  it('numbers are in ascending order (as the DB sequence guarantees)', async () => {
    const numbers = ['OC-2026-00010', 'OC-2026-00011', 'OC-2026-00012']
    const rpc = vi.fn()
    numbers.forEach((n, i) => rpc.mockResolvedValueOnce({ data: n, error: null }))
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)

    const results = await Promise.all(['pi_a', 'pi_b', 'pi_c'].map(pi => allocateInvoiceNumber(pi)))
    for (let i = 1; i < results.length; i++) {
      expect(results[i]! > results[i - 1]!).toBe(true)
    }
  })

  // ── Idempotency (resend reuses same number) ──────────────────────────────
  // The DB function returns the already-persisted number when the booking
  // already has one. The TS wrapper must not suppress or change it.

  it('returns the same number for the same PI on repeated calls (resend-safe)', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 'OC-2026-00042', error: null })
      .mockResolvedValueOnce({ data: 'OC-2026-00042', error: null }) // DB returns persisted value
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)

    const first  = await allocateInvoiceNumber('pi_same')
    const second = await allocateInvoiceNumber('pi_same')
    expect(first).toBe('OC-2026-00042')
    expect(second).toBe('OC-2026-00042')
    expect(first).toBe(second)
  })

  // ── Concurrency: two callers for the same PI ─────────────────────────────
  // The DB serialises via FOR UPDATE, so both calls eventually get the same
  // persisted number. We simulate this here: both concurrent TS calls get
  // the same value back from the RPC (as the DB would return after lock).

  it('concurrent calls for the same PI return identical numbers (DB lock behaviour)', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 'OC-2026-00099', error: null })
      .mockResolvedValueOnce({ data: 'OC-2026-00099', error: null }) // winner's number returned to loser
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)

    const [a, b] = await Promise.all([
      allocateInvoiceNumber('pi_concurrent'),
      allocateInvoiceNumber('pi_concurrent'),
    ])
    expect(a).toBe('OC-2026-00099')
    expect(b).toBe('OC-2026-00099')
    expect(a).toBe(b)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns null when the RPC returns an error (e.g. booking not found)', async () => {
    mockClient({ data: null, error: { message: 'no booking found for stripe_payment_intent_id = pi_missing' } })
    const result = await allocateInvoiceNumber('pi_missing')
    expect(result).toBeNull()
  })

  it('returns null when the RPC throws unexpectedly', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network timeout'))
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)
    const result = await allocateInvoiceNumber('pi_broken')
    expect(result).toBeNull()
  })

  it('returns null when data is not a string (unexpected RPC shape)', async () => {
    mockClient({ data: null, error: null })
    const result = await allocateInvoiceNumber('pi_weird')
    expect(result).toBeNull()
  })

  it('returns null when data is a number (would be wrong type)', async () => {
    mockClient({ data: 42, error: null })
    const result = await allocateInvoiceNumber('pi_numericdata')
    expect(result).toBeNull()
  })
})
