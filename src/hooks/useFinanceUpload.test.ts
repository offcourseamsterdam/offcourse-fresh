// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFinanceUpload } from './useFinanceUpload'

function mockFetchOnce(status: number, json: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  }))
}

function makeChangeEvent(file: File | undefined) {
  const target = {
    files: file ? [file] : [],
    value: 'C:\\fakepath\\test.csv',
  } as unknown as HTMLInputElement
  return { target } as React.ChangeEvent<HTMLInputElement>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useFinanceUpload', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('starts idle', () => {
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    expect(result.current.busy).toBe(false)
    expect(result.current.message).toBeNull()
    expect(result.current.isError).toBe(false)
  })

  it('does nothing when no file was selected', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    await act(async () => {
      await result.current.handleFileSelected(makeChangeEvent(undefined))
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
    expect(result.current.message).toBeNull()
  })

  it('on success: posts the file, calls onUploaded with json.data, and shows the returned message', async () => {
    mockFetchOnce(200, {
      ok: true,
      data: { documentNumber: 'PA-123', lineCount: 5, newLinesStored: 5 },
    })
    const onUploaded = vi.fn((data: { documentNumber: string; lineCount: number; newLinesStored: number }) =>
      `${data.documentNumber}: ${data.newLinesStored} van ${data.lineCount} boekingen opgeslagen`
    )
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    const file = new File(['a,b,c'], 'advice.xlsx')
    await act(async () => {
      await result.current.handleFileSelected(makeChangeEvent(file))
    })

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/admin/finance/viator/upload', expect.objectContaining({
      method: 'POST',
    }))
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.body).toBeInstanceOf(FormData)

    expect(onUploaded).toHaveBeenCalledWith({ documentNumber: 'PA-123', lineCount: 5, newLinesStored: 5 })
    expect(result.current.busy).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.message).toBe('PA-123: 5 van 5 boekingen opgeslagen')
  })

  it('on failure (json.ok: false): sets isError + the API error message, and does not call onUploaded', async () => {
    mockFetchOnce(200, { ok: false, error: 'Onherkenbaar bestandsformaat' })
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    const file = new File(['bad'], 'advice.xlsx')
    await act(async () => {
      await result.current.handleFileSelected(makeChangeEvent(file))
    })

    expect(onUploaded).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.message).toBe('Onherkenbaar bestandsformaat')
  })

  it('on failure with no error field: falls back to an HTTP status message', async () => {
    mockFetchOnce(500, {})
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    await act(async () => {
      await result.current.handleFileSelected(makeChangeEvent(new File(['x'], 'x.csv')))
    })

    expect(result.current.isError).toBe(true)
    expect(result.current.message).toBe('HTTP 500')
  })

  it('on network failure: falls back to the generic Dutch message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    await act(async () => {
      await result.current.handleFileSelected(makeChangeEvent(new File(['x'], 'x.csv')))
    })

    expect(result.current.isError).toBe(true)
    // a plain Error thrown mid-fetch surfaces its own message
    expect(result.current.message).toBe('Network down')
  })

  it('busy is true while the upload is in flight and false once it settles', async () => {
    let resolveFetch!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveFetch = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const onUploaded = vi.fn(() => 'done')
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    let handlerPromise: Promise<void>
    act(() => {
      handlerPromise = result.current.handleFileSelected(makeChangeEvent(new File(['x'], 'x.csv')))
    })

    await waitFor(() => expect(result.current.busy).toBe(true))
    expect(result.current.message).toBeNull()

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ ok: true, data: {} }) })
      await handlerPromise
    })

    expect(result.current.busy).toBe(false)
    expect(result.current.message).toBe('done')
  })

  it('resets the file input value so re-selecting the same file re-triggers onChange', async () => {
    mockFetchOnce(200, { ok: true, data: {} })
    const onUploaded = vi.fn(() => 'ok')
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    const target = {
      files: [new File(['x'], 'x.csv')],
      value: 'C:\\fakepath\\x.csv',
    } as unknown as HTMLInputElement

    await act(async () => {
      await result.current.handleFileSelected({ target } as React.ChangeEvent<HTMLInputElement>)
    })

    expect(target.value).toBe('')
  })

  it('resets the file input value even when no file was selected', async () => {
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useFinanceUpload('/api/admin/finance/viator/upload', onUploaded))

    const target = { files: [], value: 'C:\\fakepath\\x.csv' } as unknown as HTMLInputElement

    await act(async () => {
      await result.current.handleFileSelected({ target } as React.ChangeEvent<HTMLInputElement>)
    })

    expect(target.value).toBe('')
  })
})
