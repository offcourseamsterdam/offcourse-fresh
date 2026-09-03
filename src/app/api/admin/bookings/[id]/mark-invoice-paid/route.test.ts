import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  markPaidStripe: vi.fn().mockResolvedValue(undefined),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: h.dbSelect }) }),
      update: () => ({ eq: h.dbUpdate }),
    }),
  }),
}))

vi.mock('@/lib/stripe/invoicing', () => ({
  markStripeInvoicePaidOutOfBand: h.markPaidStripe,
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))

import { POST } from './route'

const INVOICE_BOOKING = {
  id: 'b-123',
  stripe_invoice_id: 'in_test_999',
  company_name: 'Acme Corp',
  customer_name: 'Jane Doe',
  customer_email: 'jane@acme.com',
  stripe_amount: 50000,
  listing_title: 'Classic Salon Boat Tour',
  booking_date: '2026-07-01',
  payment_status: 'stripe_invoice_sent',
}

function mockReq(): NextRequest {
  return {} as unknown as NextRequest
}

function mockParams(id = 'b-123') {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/admin/bookings/[id]/mark-invoice-paid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.dbSelect.mockResolvedValue({ data: INVOICE_BOOKING, error: null })
    h.dbUpdate.mockResolvedValue({ error: null })
  })

  it('rejects unauthenticated requests', async () => {
    const { NextResponse } = await import('next/server')
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await POST(mockReq(), mockParams())
    expect(res.status).toBe(401)
  })

  it('marks invoice paid in Stripe and updates Supabase', async () => {
    const res = await POST(mockReq(), mockParams())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    expect(h.markPaidStripe).toHaveBeenCalledWith('in_test_999')
    expect(h.postSlackOps).toHaveBeenCalled()
  })

  it('returns early if booking is already paid', async () => {
    h.dbSelect.mockResolvedValueOnce({
      data: { ...INVOICE_BOOKING, payment_status: 'paid' },
      error: null,
    })
    const res = await POST(mockReq(), mockParams())
    expect(res.status).toBe(200)
    expect(h.markPaidStripe).not.toHaveBeenCalled()
  })
})
