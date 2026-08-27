import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  update: mockUpdate,
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/lib/realtime/notify-bookings-changed', () => ({
  notifyBookingsChanged: vi.fn().mockResolvedValue(undefined),
}))

const mockSendTwilioSms = vi.fn()
vi.mock('@/lib/twilio/client', () => ({
  normalizePhoneNumber: (raw: string) => {
    if (raw.startsWith('06')) return '+316' + raw.slice(2)
    if (raw.startsWith('+')) return raw.replace(/\s+/g, '')
    return null
  },
  sendTwilioSms: (...args: any[]) => mockSendTwilioSms(...args),
}))

describe('GET /api/admin/bookings/[id]/review-sms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns booking details and rendered preview message', async () => {
    mockSelect.mockImplementation((fields: string) => {
      if (fields.includes('customer_name')) {
        return {
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'b_123',
                customer_name: 'John Doe',
                customer_phone: '0612345678',
                customer_email: 'john@example.com',
                listing_title: 'Sunset Cruise',
                review_sms_sent_at: null,
                review_sms_phone: null,
                review_sms_sid: null,
              },
              error: null,
            }),
          }),
        }
      }
      return {
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              review_sms_template: null,
              review_sms_enabled: true,
            },
            error: null,
          }),
        }),
      }
    })

    const req = new NextRequest('https://offcourseamsterdam.com/api/admin/bookings/b_123/review-sms')
    const res = await GET(req, { params: Promise.resolve({ id: 'b_123' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.preview.message).toContain('Hi John!')
    expect(json.data.preview.message).toContain('Sunset Cruise')
    expect(json.data.preview.normalizedPhone).toBe('+31612345678')
    expect(json.data.preview.alreadySent).toBe(false)
  })
})

describe('POST /api/admin/bookings/[id]/review-sms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends SMS and updates booking record', async () => {
    mockSelect.mockImplementation((fields: string) => {
      if (fields.includes('customer_name')) {
        return {
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'b_123',
                customer_name: 'John Doe',
                customer_phone: '0612345678',
                listing_title: 'Sunset Cruise',
                review_sms_sent_at: null,
              },
              error: null,
            }),
          }),
        }
      }
      return {
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              review_sms_template: null,
            },
            error: null,
          }),
        }),
      }
    })

    mockUpdate.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    mockSendTwilioSms.mockResolvedValue({
      success: true,
      sid: 'SMtest_123456',
    })

    const req = new NextRequest('https://offcourseamsterdam.com/api/admin/bookings/b_123/review-sms', {
      method: 'POST',
      body: JSON.stringify({
        phone: '0612345678',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'b_123' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.sent).toBe(true)
    expect(json.data.sid).toBe('SMtest_123456')
    expect(mockSendTwilioSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+31612345678',
        body: expect.stringContaining('Hi John!'),
      })
    )
  })

  it('prevents double-sending when already sent and force is not set', async () => {
    mockSelect.mockImplementation((fields: string) => {
      if (fields.includes('customer_name')) {
        return {
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'b_123',
                customer_name: 'John Doe',
                customer_phone: '0612345678',
                review_sms_sent_at: '2026-08-27T10:00:00Z',
              },
              error: null,
            }),
          }),
        }
      }
      return {
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              review_sms_template: null,
            },
            error: null,
          }),
        }),
      }
    })

    const req = new NextRequest('https://offcourseamsterdam.com/api/admin/bookings/b_123/review-sms', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'b_123' }) })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.ok).toBe(false)
    expect(json.error).toContain('already sent')
    expect(mockSendTwilioSms).not.toHaveBeenCalled()
  })
})
