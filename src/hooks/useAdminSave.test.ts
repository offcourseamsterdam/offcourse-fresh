// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { adminMutate, useAdminSave } from './useAdminSave'

function mockFetchOnce(status: number, json: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adminMutate', () => {
  it('returns the unwrapped data on success', async () => {
    mockFetchOnce(200, { ok: true, data: { id: 'abc' } })
    await expect(adminMutate('/api/admin/x', 'POST', { a: 1 })).resolves.toEqual({ id: 'abc' })
  })

  it('sends JSON body and content-type', async () => {
    mockFetchOnce(200, { ok: true, data: null })
    await adminMutate('/api/admin/x', 'PUT', { name: 'Diana' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/admin/x')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe(JSON.stringify({ name: 'Diana' }))
  })

  it('omits body and content-type for body-less requests', async () => {
    mockFetchOnce(200, { ok: true, data: null })
    await adminMutate('/api/admin/x/1', 'DELETE')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.headers).toBeUndefined()
    expect(init?.body).toBeUndefined()
  })

  it('throws the API error message on ok:false', async () => {
    mockFetchOnce(422, { ok: false, error: 'Name is taken' })
    await expect(adminMutate('/api/admin/x', 'POST', {})).rejects.toThrow('Name is taken')
  })

  it('throws HTTP status when the response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    }))
    await expect(adminMutate('/api/admin/x', 'POST', {})).rejects.toThrow('HTTP 500')
  })
})

describe('useAdminSave', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('sets saving during the action and clears it after', async () => {
    const { result } = renderHook(() => useAdminSave())
    let resolveAction: () => void
    const pending = new Promise<void>((r) => { resolveAction = r })

    let runPromise: Promise<void>
    act(() => { runPromise = result.current.run(() => pending) })
    expect(result.current.saving).toBe(true)

    await act(async () => { resolveAction!(); await runPromise! })
    expect(result.current.saving).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('captures a thrown Error message', async () => {
    const { result } = renderHook(() => useAdminSave())
    await act(() => result.current.run(async () => { throw new Error('Save failed') }))
    expect(result.current.error).toBe('Save failed')
    expect(result.current.saving).toBe(false)
  })

  it('falls back to a generic message for non-Error throws', async () => {
    const { result } = renderHook(() => useAdminSave())
    await act(() => result.current.run(async () => { throw 'boom' }))
    expect(result.current.error).toBe('Something went wrong')
  })

  it('clears a previous error when a new run starts', async () => {
    const { result } = renderHook(() => useAdminSave())
    act(() => { result.current.setError('Name is required') })
    expect(result.current.error).toBe('Name is required')
    await act(() => result.current.run(async () => {}))
    expect(result.current.error).toBeNull()
  })
})
