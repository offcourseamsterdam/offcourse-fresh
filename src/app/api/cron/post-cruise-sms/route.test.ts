import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  bookings: [] as Record<string, unknown>[],
  config: { review_sms_enabled: true, review_sms_auto_send: false, review_sms_template: null } as Record<string, unknown> | null,
}))

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  notifyBookingsChanged: vi.fn().mockResolvedValue(undefined),
  sendTwilioSms: vi.fn(),
  normalizePhoneNumber: (raw: string) => {
    if (!raw) return null
    if (raw.startsWith('06')) return '+316' + raw.slice(2)
    if (raw.startsWith('+')) return raw.replace(/\s+/g, '')
    return null
  },
}))

const updateSpy = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/realtime/notify-bookings-changed', () => ({ notifyBookingsChanged: h.notifyBookingsChanged }))
vi.mock('@/lib/twilio/client', () => ({
  sendTwilioSms: (...args: unknown[]) => h.sendTwilioSms(...args),
  normalizePhoneNumber: h.normalizePhoneNumber,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({
            in: () => ({
              is: () => ({
                not: () => ({
                  lte: () => ({
                    gte: () => ({
                      order: () => Promise.resolve({ data: state.bookings, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: (patch: unknown) => {
            updateSpy(patch)
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'google_reviews_config') {
        return {
          select: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: state.config, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

function makeRequest(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest
}

describe('GET /api/cron/post-cruise-sms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.bookings = []
    state.config = { review_sms_enabled: true, review_sms_auto_send: false, review_sms_template: null }
  })

  it('enforces requireCronSecret', async () => {
    const denied = new Response(null, { status: 401 })
    h.requireCronSecret.mockReturnValueOnce(denied as unknown as ReturnType<typeof h.requireCronSecret>)
    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    expect(res).toBe(denied)
  })

  it('skips entirely when review_sms_enabled is false', async () => {
    state.config = { review_sms_enabled: false, review_sms_auto_send: false, review_sms_template: null }
    state.bookings = [{ id: 'b1', customer_name: 'Anna', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-27T10:00:00Z' }]
    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.checked).toBe(0)
    expect(h.postSlackOps).not.toHaveBeenCalled()
    expect(h.sendTwilioSms).not.toHaveBeenCalled()
  })

  it('proposes via Slack DM when auto_send is false (default)', async () => {
    state.bookings = [
      { id: 'b1', customer_name: 'Anna Smith', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-27T10:00:00Z' },
      { id: 'b2', customer_name: 'Jon', customer_phone: '0687654321', listing_title: 'Private Tour', end_time: '2026-08-27T12:00:00Z' },
    ]
    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.checked).toBe(2)
    expect(json.proposed).toBe(2)
    expect(json.sent).toBe(0)
    expect(h.sendTwilioSms).not.toHaveBeenCalled()
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    const slackText = h.postSlackOps.mock.calls[0][0] as string
    expect(slackText).toContain('Anna Smith')
    expect(slackText).toContain('Jon')
    expect(slackText).toContain('/admin/bookings')
  })

  it('sends directly via Twilio and records idempotency columns when auto_send is true', async () => {
    state.config = { review_sms_enabled: true, review_sms_auto_send: true, review_sms_template: null }
    state.bookings = [
      { id: 'b1', customer_name: 'Anna Smith', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-27T10:00:00Z' },
    ]
    h.sendTwilioSms.mockResolvedValue({ success: true, sid: 'SMabc123' })

    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.sent).toBe(1)
    expect(h.sendTwilioSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+31612345678', body: expect.stringContaining('Hi Anna!') })
    )
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ review_sms_sent_at: expect.any(String), review_sms_phone: '+31612345678', review_sms_sid: 'SMabc123' })
    )
    expect(h.notifyBookingsChanged).toHaveBeenCalled()
  })

  it('collects errors without throwing when Twilio send fails in auto_send mode', async () => {
    state.config = { review_sms_enabled: true, review_sms_auto_send: true, review_sms_template: null }
    state.bookings = [
      { id: 'b1', customer_name: 'Anna Smith', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-27T10:00:00Z' },
    ]
    h.sendTwilioSms.mockResolvedValue({ success: false, error: 'Twilio HTTP error 400' })

    const { GET } = await import('./route')
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.sent).toBe(0)
    expect(json.errors).toBe(1)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    expect(h.postSlackOps.mock.calls[0][0]).toContain('Twilio HTTP error 400')
  })
})
