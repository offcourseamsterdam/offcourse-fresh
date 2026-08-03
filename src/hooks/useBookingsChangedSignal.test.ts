// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { BOOKINGS_CHANGED_CHANNEL, BOOKINGS_CHANGED_EVENT } from '@/lib/realtime/bookings-channel'

const h = vi.hoisted(() => ({
  channelFn: vi.fn(),
  onFn: vi.fn(),
  subscribeFn: vi.fn(),
  removeChannelFn: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: h.channelFn,
    removeChannel: h.removeChannelFn,
  }),
}))

import { useBookingsChangedSignal } from './useBookingsChangedSignal'

describe('useBookingsChangedSignal', () => {
  let capturedCallback: (() => void) | null

  beforeEach(() => {
    vi.clearAllMocks()
    capturedCallback = null
    const fakeChannel = { __fake: true }
    h.onFn.mockImplementation((_event, _filter, cb) => {
      capturedCallback = cb
      return { subscribe: h.subscribeFn }
    })
    h.subscribeFn.mockReturnValue(fakeChannel)
    h.channelFn.mockImplementation((name: string) => {
      expect(name).toBe(BOOKINGS_CHANGED_CHANNEL)
      return { on: h.onFn }
    })
  })

  it('subscribes to the shared channel/event on mount', () => {
    renderHook(() => useBookingsChangedSignal(() => {}))

    expect(h.channelFn).toHaveBeenCalledWith(BOOKINGS_CHANGED_CHANNEL)
    expect(h.onFn).toHaveBeenCalledWith('broadcast', { event: BOOKINGS_CHANGED_EVENT }, expect.any(Function))
    expect(h.subscribeFn).toHaveBeenCalledTimes(1)
  })

  it('calls onChange when the broadcast fires', () => {
    const onChange = vi.fn()
    renderHook(() => useBookingsChangedSignal(onChange))

    expect(capturedCallback).not.toBeNull()
    capturedCallback!()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('always invokes the latest onChange without resubscribing on rerender', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useBookingsChangedSignal(cb), {
      initialProps: { cb: first },
    })

    rerender({ cb: second })

    // Still only one subscription — the ref pattern avoids a resubscribe on
    // every render even though `second` is a different function identity.
    expect(h.channelFn).toHaveBeenCalledTimes(1)

    capturedCallback!()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useBookingsChangedSignal(() => {}))
    unmount()

    expect(h.removeChannelFn).toHaveBeenCalledTimes(1)
  })
})
