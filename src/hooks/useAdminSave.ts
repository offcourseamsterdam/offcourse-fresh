'use client'

import { useCallback, useState } from 'react'

/**
 * Thrown by adminMutate on a `{ ok: false }` response. A plain `Error`
 * subclass — every existing `catch (err) { err instanceof Error ? err.message
 * : ... }` call site keeps working unchanged — but callers that need more
 * than the message (e.g. the invoice approve/pay routes' `suggested_cents`,
 * see src/lib/api/response.ts's `apiError` `extra` param) can read `.extra`.
 */
export class AdminApiError extends Error {
  extra: Record<string, unknown>
  constructor(message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AdminApiError'
    this.extra = extra
  }
}

/**
 * Mutation counterpart to adminFetcher (useAdminFetch.ts): POST/PUT/DELETE to
 * an admin API route, throwing on HTTP or `{ ok: false }` failures so callers
 * only handle the happy path. Returns the unwrapped `data` payload.
 */
export async function adminMutate<T = unknown>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!json) throw new Error(`HTTP ${res.status}`)
  if (!json.ok) {
    const { ok: _ok, error, data: _data, ...extra } = json
    throw new AdminApiError(error ?? 'Request failed', extra)
  }
  return json.data as T
}

export interface UseAdminSaveResult {
  saving: boolean
  error: string | null
  /** For inline validation messages before any request is made. */
  setError: (message: string | null) => void
  /**
   * Run an async action with the standard saving/error lifecycle:
   * clears the error, sets `saving`, catches anything thrown into `error`.
   */
  run: (action: () => Promise<void>) => Promise<void>
}

/**
 * The submit-lifecycle state every admin CRUD modal was hand-rolling:
 * `saving` flag, error message, and a try/catch/finally wrapper.
 *
 * Typical usage:
 *   const { saving, error, setError, run } = useAdminSave()
 *   function handleSubmit(e: React.FormEvent) {
 *     e.preventDefault()
 *     if (!name.trim()) { setError('Name is required'); return }
 *     run(async () => {
 *       await adminMutate(url, editing ? 'PUT' : 'POST', payload)
 *       onSaved()
 *       onClose()
 *     })
 *   }
 */
export function useAdminSave(): UseAdminSaveResult {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (action: () => Promise<void>) => {
    setSaving(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }, [])

  return { saving, error, setError, run }
}
