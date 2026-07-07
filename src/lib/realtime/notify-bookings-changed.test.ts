import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyBookingsChanged } from './notify-bookings-changed'
import { BOOKINGS_CHANGED_CHANNEL, BOOKINGS_CHANGED_EVENT } from './bookings-channel'

describe('notifyBookingsChanged', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  })

  it('POSTs a broadcast to the Realtime REST endpoint with the shared topic/event', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    vi.stubGlobal('fetch', mockFetch)

    await notifyBookingsChanged()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://test.supabase.co/realtime/v1/api/broadcast')
    expect(init.headers.apikey).toBe('test-service-key')
    expect(init.headers.Authorization).toBe('Bearer test-service-key')
    const body = JSON.parse(init.body)
    expect(body.messages).toEqual([
      { topic: BOOKINGS_CHANGED_CHANNEL, event: BOOKINGS_CHANGED_EVENT, payload: {} },
    ])
  })

  it('no-ops without throwing when env vars are missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await expect(notifyBookingsChanged()).resolves.toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('never throws when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(notifyBookingsChanged()).resolves.toBeUndefined()
  })
})
