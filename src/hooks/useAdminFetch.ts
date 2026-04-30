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
  isLoading: boolean
  error: string | null
  refresh: () => void
  mutate: (updater?: (prev: T | undefined) => T | undefined, opts?: { revalidate?: boolean }) => void
}

export function useAdminFetch<T>(url: string | null): UseAdminFetchResult<T> {
  const { data, error, isLoading, mutate } = useSWR<T>(url, adminFetcher, {
    keepPreviousData: true,
    dedupingInterval: 30_000,
    revalidateOnFocus: false,
    errorRetryCount: 2,
  })

  return {
    data,
    isLoading,
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
