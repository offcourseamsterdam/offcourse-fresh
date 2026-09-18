import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendPartnerBookingNotification } from './send-booking-notification'

const mockSend = vi.fn()
vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: mockSend,
      }
    },
  }
})

describe('sendPartnerBookingNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null })
  })

  function createMockSupabase({
    partner = { id: 'p-1', name: 'Amsterdam Boat Company', email: 'info@amsterdamboatcompany.com', report_token: 'tok-123', is_active: true } as unknown,
    settings = { notify_per_booking: true, email_recipients: ['info@amsterdamboatcompany.com'] } as unknown,
    campaign = { name: 'Private Hidden Gems' } as unknown,
  } = {}) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'partners') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: partner, error: null })),
              })),
            })),
          }
        }
        if (table === 'notification_settings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: settings, error: null })),
              })),
            })),
          }
        }
        if (table === 'campaigns') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: campaign, error: null })),
              })),
            })),
          }
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        }
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  it('sends email to partner when notify_per_booking is true', async () => {
    const supabase = createMockSupabase()
    const result = await sendPartnerBookingNotification({
      partnerId: 'p-1',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: '2026-05-10',
      startTime: '2026-05-10T14:00:00.000Z',
      endTime: '2026-05-10T16:00:00.000Z',
      guestCount: 6,
      customerTypeName: 'Diana - 2 Hours',
      baseAmountCents: 40000,
      commissionAmountCents: 7339,
      campaignId: 'c-1',
      supabase,
    })

    expect(result).toEqual({
      ok: true,
      sent: true,
      recipients: ['info@amsterdamboatcompany.com'],
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.to).toEqual(['info@amsterdamboatcompany.com'])
    expect(callArgs.subject).toContain('Private Hidden Gems Cruise')
    expect(callArgs.subject).toContain('€73.39')
    expect(callArgs.html).toContain('Diana - 2 Hours')
    expect(callArgs.html).toContain('Amsterdam Boat Company')
    expect(callArgs.html).toContain('tok-123')
  })

  it('skips email when notify_per_booking is false', async () => {
    const supabase = createMockSupabase({
      settings: { notify_per_booking: false, email_recipients: ['info@amsterdamboatcompany.com'] },
    })

    const result = await sendPartnerBookingNotification({
      partnerId: 'p-1',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: '2026-05-10',
      startTime: null,
      guestCount: 4,
      baseAmountCents: 31000,
      commissionAmountCents: 5688,
      supabase,
    })

    expect(result).toEqual({ ok: true, sent: false, recipients: [] })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('falls back to partner.email when notification_settings has empty recipients', async () => {
    const supabase = createMockSupabase({
      settings: { notify_per_booking: true, email_recipients: [] },
      partner: { id: 'p-1', name: 'Amsterdam Boat Company', email: 'primary@amsterdamboatcompany.com', report_token: 'tok-123', is_active: true },
    })

    const result = await sendPartnerBookingNotification({
      partnerId: 'p-1',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: '2026-05-10',
      startTime: null,
      guestCount: 4,
      baseAmountCents: 31000,
      commissionAmountCents: 5688,
      supabase,
    })

    expect(result).toEqual({
      ok: true,
      sent: true,
      recipients: ['primary@amsterdamboatcompany.com'],
    })
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['primary@amsterdamboatcompany.com'],
      }),
    )
  })

  it('returns error when partner is inactive or not found', async () => {
    const supabase = createMockSupabase({ partner: null })
    const result = await sendPartnerBookingNotification({
      partnerId: 'p-unknown',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: '2026-05-10',
      startTime: null,
      guestCount: 4,
      baseAmountCents: 31000,
      commissionAmountCents: 5688,
      supabase,
    })

    expect(result).toEqual({ ok: false, reason: 'Partner not found or inactive' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns error when no email recipients are available', async () => {
    const supabase = createMockSupabase({
      partner: { id: 'p-1', name: 'No Email Partner', email: null, report_token: 'tok-1', is_active: true },
      settings: { notify_per_booking: true, email_recipients: [] },
    })

    const result = await sendPartnerBookingNotification({
      partnerId: 'p-1',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: '2026-05-10',
      startTime: null,
      guestCount: 4,
      baseAmountCents: 31000,
      commissionAmountCents: 5688,
      supabase,
    })

    expect(result).toEqual({ ok: false, reason: 'No email recipients found for partner' })
    expect(mockSend).not.toHaveBeenCalled()
  })
})
