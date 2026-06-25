import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  fhCancel: vi.fn().mockResolvedValue(undefined),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  stripeRefunds: vi.fn().mockResolvedValue({ id: 'ref_123' }),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({ cancelBooking: h.fhCancel }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: h.dbSelect }) }),
      update: () => ({ eq: h.dbUpdate }),
    }),
  }),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ refunds: { create: h.stripeRefunds } }),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))

import { POST } from './route'

const BOOKING = {
  id: 1,
  booking_uuid: 'fh-uuid-abc',
  status: 'confirmed',
  booking_source: 'website',
  stripe_payment_intent_id: 'pi_test_123',
  stripe_amount: 16500,
  customer_name: 'Enrico Test',
  customer_email: 'enrico@example.com',
  listing_title: 'Diana 2h Private',
  booking_date: '2026-06-25',
  start_time: '2026-06-25T12:00:00Z',
}

function mockReq(body: object = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

function mockParams(id = '1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbSelect.mockResolvedValue({ data: BOOKING, error: null })
  h.dbUpdate.mockResolvedValue({ error: null })
  h.fhCancel.mockResolvedValue(undefined)
  h.stripeRefunds.mockResolvedValue({ id: 'ref_123' })
})

describe('POST /api/admin/bookings/[id]/cancel', () => {
  it('cancels FH booking and marks status as cancelled in DB', async () => {
    const res = await POST(mockReq(), mockParams())
    const json = await res.json()
    expect(json.data.cancelled).toBe(true)
    expect(h.fhCancel).toHaveBeenCalledWith('fh-uuid-abc')
    expect(h.dbUpdate).toHaveBeenCalled()
  })

  it('skips FH cancel when booking is already cancelled in DB', async () => {
    h.dbSelect.mockResolvedValue({ data: { ...BOOKING, status: 'cancelled' }, error: null })
    await POST(mockReq(), mockParams())
    expect(h.fhCancel).not.toHaveBeenCalled()
  })

  it('returns 404 when booking not found', async () => {
    h.dbSelect.mockResolvedValue({ data: null, error: new Error('not found') })
    const res = await POST(mockReq(), mockParams())
    expect(res.status).toBe(404)
  })

  it('issues a full Stripe refund for website bookings', async () => {
    const res = await POST(mockReq({ refundOption: 'full' }), mockParams())
    const json = await res.json()
    expect(json.data.refundId).toBe('ref_123')
    expect(h.stripeRefunds).toHaveBeenCalledWith({ payment_intent: 'pi_test_123' })
  })

  it('issues a partial Stripe refund with the specified amount', async () => {
    await POST(mockReq({ refundOption: 'partial', partialAmountCents: 8000 }), mockParams())
    expect(h.stripeRefunds).toHaveBeenCalledWith({
      payment_intent: 'pi_test_123',
      amount: 8000,
    })
  })

  it('skips Stripe refund when refundOption is none (default)', async () => {
    await POST(mockReq(), mockParams())
    expect(h.stripeRefunds).not.toHaveBeenCalled()
  })

  it('skips Stripe refund for non-website bookings', async () => {
    h.dbSelect.mockResolvedValue({ data: { ...BOOKING, booking_source: 'admin' }, error: null })
    await POST(mockReq({ refundOption: 'full' }), mockParams())
    expect(h.stripeRefunds).not.toHaveBeenCalled()
  })

  it('returns refundError in response when Stripe fails but still marks cancelled', async () => {
    h.stripeRefunds.mockRejectedValue(new Error('Card declined'))
    const res = await POST(mockReq({ refundOption: 'full' }), mockParams())
    const json = await res.json()
    expect(json.data.cancelled).toBe(true)
    expect(json.data.refundError).toContain('Card declined')
  })

  it('sends a Slack notification on cancel', async () => {
    await POST(mockReq(), mockParams())
    expect(h.postSlackText).toHaveBeenCalledOnce()
    const msg = h.postSlackText.mock.calls[0][0] as string
    expect(msg).toContain('cancelled')
    expect(msg).toContain('Enrico Test')
    expect(msg).toContain('enrico@example.com')
    expect(msg).toContain('Diana 2h Private')
    expect(msg).toContain('2026-06-25')
  })

  it('Slack message shows refund amount for full refunds', async () => {
    await POST(mockReq({ refundOption: 'full' }), mockParams())
    const msg = h.postSlackText.mock.calls[0][0] as string
    expect(msg).toContain('full €165')
  })

  it('Slack message shows partial amount for partial refunds', async () => {
    await POST(mockReq({ refundOption: 'partial', partialAmountCents: 8000 }), mockParams())
    const msg = h.postSlackText.mock.calls[0][0] as string
    expect(msg).toContain('partial €80')
  })

  it('Slack message shows no refund when refundOption is none', async () => {
    await POST(mockReq({ refundOption: 'none' }), mockParams())
    const msg = h.postSlackText.mock.calls[0][0] as string
    expect(msg).toContain('no refund')
  })

  it('continues gracefully if FH cancel throws a known already-cancelled error', async () => {
    const { FHValidationError } = await import('@/lib/fareharbor/types')
    h.fhCancel.mockRejectedValue(new FHValidationError(['Booking is already cancelled']))
    const res = await POST(mockReq(), mockParams())
    const json = await res.json()
    expect(json.data.cancelled).toBe(true)
  })
})
