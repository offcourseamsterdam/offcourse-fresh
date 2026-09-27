import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  dbUpsert: vi.fn().mockReturnValue({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'prof-99' } }) }) }),
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test_123' }),
  createInvoice: vi.fn().mockResolvedValue({
    invoiceId: 'in_test_999',
    invoiceNumber: 'INV-2026-0001',
    hostedInvoiceUrl: 'https://invoice.stripe.com/test',
    pdfUrl: 'https://invoice.stripe.com/test.pdf',
    dueDate: '2026-07-15',
    amountDueCents: 45000,
  }),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
  partnerSelect: vi.fn().mockResolvedValue({ data: null }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'business_profiles') {
        return {
          upsert: h.dbUpsert,
        }
      }
      if (table === 'partners') {
        return { select: () => ({ eq: () => ({ maybeSingle: h.partnerSelect }) }) }
      }
      return {
        select: () => ({ eq: () => ({ single: h.dbSelect }) }),
        update: () => ({ eq: h.dbUpdate }),
      }
    },
  }),
}))

vi.mock('@/lib/stripe/invoicing', () => ({
  getOrCreateStripeCustomer: h.createCustomer,
  createAndSendStripeInvoice: h.createInvoice,
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))

import { POST } from './route'

const EXISTING_BOOKING = {
  id: 'b-999',
  booking_id: 'B-2026-001',
  booking_uuid: 'fh-uuid-1',
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  customer_phone: '+31612345678',
  booking_date: '2026-07-01',
  start_time: '2026-07-01T14:00:00Z',
  guest_count: 6,
  base_amount_cents: 35000,
  extras_selected: [{ name: 'Drinks Package', amount_cents: 10000 }],
  discount_amount_cents: 0,
  listing_title: 'Classic Private Tour',
  status: 'confirmed',
  payment_status: 'unpaid',
  booking_source: 'invoice_later',
}

function mockReq(body: object = {}): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

function mockParams(id = 'b-999') {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/admin/bookings/[id]/send-invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.dbSelect.mockResolvedValue({ data: EXISTING_BOOKING, error: null })
    h.dbUpdate.mockResolvedValue({ error: null })
  })

  it('rejects unauthenticated requests', async () => {
    const { NextResponse } = await import('next/server')
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await POST(mockReq({ companyName: 'Acme Corp' }), mockParams())
    expect(res.status).toBe(401)
  })

  it('rejects if booking is cancelled', async () => {
    h.dbSelect.mockResolvedValueOnce({
      data: { ...EXISTING_BOOKING, status: 'cancelled' },
      error: null,
    })
    const res = await POST(mockReq({ companyName: 'Acme Corp' }), mockParams())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('geannuleerd')
  })

  it('rejects bookings whose source is not invoice_later (e.g. complimentary)', async () => {
    h.dbSelect.mockResolvedValueOnce({
      data: { ...EXISTING_BOOKING, booking_source: 'complimentary' },
      error: null,
    })
    const res = await POST(mockReq({ companyName: 'Acme Corp' }), mockParams())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invoice later')
    expect(h.createInvoice).not.toHaveBeenCalled()
  })

  it('rejects when a Stripe invoice is already linked', async () => {
    h.dbSelect.mockResolvedValueOnce({ data: { ...EXISTING_BOOKING, stripe_invoice_id: 'in_existing' }, error: null })
    const res = await POST(mockReq({ companyName: 'Acme Corp' }), mockParams())
    expect(res.status).toBe(400)
    expect(h.createInvoice).not.toHaveBeenCalled()
  })

  it('rejects a booking that is already paid', async () => {
    h.dbSelect.mockResolvedValueOnce({ data: { ...EXISTING_BOOKING, payment_status: 'paid' }, error: null })
    const res = await POST(mockReq({ companyName: 'Acme Corp' }), mockParams())
    expect(res.status).toBe(400)
    expect(h.createInvoice).not.toHaveBeenCalled()
  })

  it('deducts the partner commission on the invoice when the booking has a partner', async () => {
    h.dbSelect.mockResolvedValueOnce({
      data: { ...EXISTING_BOOKING, partner_id: 'partner-ab', commission_amount_cents: 5688 },
      error: null,
    })
    h.partnerSelect.mockResolvedValueOnce({ data: { name: 'Amsterdam Boats B.V.', commission_rate: 20 } })

    const res = await POST(mockReq({ companyName: 'Amsterdam Boats B.V.', contactEmail: 'info@amsterdam-boats.com' }), mockParams())

    expect(res.status).toBe(200)
    expect(h.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      partnerCommission: expect.objectContaining({ partnerName: 'Amsterdam Boats B.V.', commissionAmountCents: 5688 }),
    }))
  })

  it('does not deduct the commission when the admin unticks it', async () => {
    h.dbSelect.mockResolvedValueOnce({
      data: { ...EXISTING_BOOKING, partner_id: 'partner-ab', commission_amount_cents: 5688 },
      error: null,
    })

    await POST(mockReq({ companyName: 'Acme Corp', deductPartnerCommission: false }), mockParams())

    expect(h.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ partnerCommission: null }))
  })

  it('creates Stripe customer, generates and sends invoice, and updates booking', async () => {
    const res = await POST(
      mockReq({
        companyName: 'Acme Amsterdam B.V.',
        kvkNumber: '12345678',
        vatNumber: 'NL123456789B01',
        addressLine1: 'Keizersgracht 100',
        postalCode: '1015AA',
        city: 'Amsterdam',
        contactName: 'John Doe',
        contactEmail: 'invoices@acme.com',
      }),
      mockParams()
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data.invoiceId).toBe('in_test_999')
    expect(json.data.hostedInvoiceUrl).toBe('https://invoice.stripe.com/test')

    expect(h.createCustomer).toHaveBeenCalledWith(expect.objectContaining({
      companyName: 'Acme Amsterdam B.V.',
      email: 'invoices@acme.com',
    }))

    expect(h.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cus_test_123',
      baseAmountCents: 35000,
    }))

    expect(h.dbUpdate).toHaveBeenCalled()
    expect(h.postSlackOps).toHaveBeenCalled()
  })
})
