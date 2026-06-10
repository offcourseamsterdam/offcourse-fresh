'use client'

import { useCallback, useState } from 'react'

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
  if (!json.ok) throw new Error(json.error ?? 'Request failed')
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
