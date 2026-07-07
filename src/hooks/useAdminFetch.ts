'use client'

import useSWR from 'swr'

export async function adminFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error ?? 'Request failed')
  return json.data as T
}

export interface UseAdminFetchResult<T> {
  data: T | undefined
  /** True during initial load (no cached data) OR during a manual refresh. */
  isLoading: boolean
  error: string | null
  refresh: () => void
  mutate: (updater?: (prev: T | undefined) => T | undefined, opts?: { revalidate?: boolean }) => void
}

export interface UseAdminFetchOptions {
  /** Poll this often (ms) in the background, in addition to the manual refresh
   *  button. Opt-in — omit for the default "only refetch on demand" behavior.
   *  Use for views where staff expect to see new data land on its own (e.g. a
   *  bookings list), not for rarely-changing settings pages. */
  refreshIntervalMs?: number
}

export function useAdminFetch<T>(url: string | null, options?: UseAdminFetchOptions): UseAdminFetchResult<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(url, adminFetcher, {
    keepPreviousData: true,
    dedupingInterval: 30_000,
    revalidateOnFocus: false,
    errorRetryCount: 2,
    refreshInterval: options?.refreshIntervalMs,
  })

  return {
    data,
    // isValidating covers manual refresh (when cached data exists isLoading stays false)
    isLoading: isLoading || isValidating,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh: () => { mutate() },
    mutate: (updater, opts) => {
      if (updater) {
        mutate(prev => updater(prev), opts)
      } else {
        mutate()
      }
    },
  }
}
