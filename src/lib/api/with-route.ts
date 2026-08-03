import type { NextResponse } from 'next/server'
import { apiError } from './response'

/**
 * Wraps a route handler so a thrown error (malformed body, Supabase outage, etc.)
 * always returns the `{ok:false,error}` JSON shape instead of Next's unstructured
 * 500 page — which `adminMutate`/`useAdminFetch` can't parse as JSON.
 */
export function withRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (err) {
      return apiError(err instanceof Error ? err.message : 'Unknown error')
    }
  }
}
