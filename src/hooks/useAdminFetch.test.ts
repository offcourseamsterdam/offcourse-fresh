// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { adminFetcher, useAdminFetch } from './useAdminFetch'

// ── adminFetcher tests (pure async function) ───────────────────────────────

describe('adminFetcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns json.data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: [{ id: 1 }] }),
    }))
    const result = await adminFetcher('/api/admin/test')
    expect(result).toEqual([{ id: 1 }])
  })

  it('throws when json.ok is false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'Not found' }),
    }))
    await expect(adminFetcher('/api/admin/test')).rejects.toThrow('Not found')
  })

  it('throws with fallback message when json.ok is false and no error field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    }))
    await expect(adminFetcher('/api/admin/test')).rejects.toThrow('Request failed')
  })

  it('throws on non-200 HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }))
    await expect(adminFetcher('/api/admin/test')).rejects.toThrow('HTTP 500')
  })

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))
    await expect(adminFetcher('/api/admin/test')).rejects.toThrow('Network failure')
  })
})

// ── useAdminFetch tests (hook via renderHook) ──────────────────────────────

describe('useAdminFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data on successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: ['booking1', 'booking2'] }),
    }))

    const { result } = renderHook(() => useAdminFetch<string[]>('/api/admin/t1'))
    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data).toEqual(['booking1', 'booking2'])
    expect(result.current.error).toBeNull()
  })

  it('returns error string when json.ok is false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'Unauthorized' }),
    }))

    const { result } = renderHook(() => useAdminFetch<string[]>('/api/admin/t2'))
    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.error).toBe('Unauthorized')
    expect(result.current.data).toBeUndefined()
  })

  it('does not fetch when url is null', () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    renderHook(() => useAdminFetch<string[]>(null))

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls refresh to re-fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useAdminFetch<string[]>('/api/admin/t3'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const callsBefore = mockFetch.mock.calls.length
    result.current.refresh()
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore))
  })
})
