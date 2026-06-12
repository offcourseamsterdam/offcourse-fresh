/**
 * Simple in-memory sliding window rate limiter.
 * No external dependencies needed at this scale.
 *
 * Limits are per IP address. In serverless (Vercel), each function instance
 * has its own memory, so limits are approximate — but good enough to prevent
 * obvious abuse. For exact enforcement at scale, use Vercel's Edge middleware
 * or a Redis-based solution.
 */

import { NextResponse, type NextRequest } from 'next/server'

interface WindowEntry {
  count: number
  resetAt: number
}

const windows = new Map<string, WindowEntry>()

// Clean up old entries periodically to prevent memory leaks
const CLEANUP_INTERVAL = 60_000 // 1 minute
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of windows) {
    if (entry.resetAt < now) windows.delete(key)
  }
}

/**
 * Check if a request should be allowed.
 * Returns true if under the limit, false if rate limited.
 */
export function checkRateLimit(
  ip: string,
  namespace: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  cleanup()

  const now = Date.now()
  const key = `${namespace}:${ip}`
  const entry = windows.get(key)

  if (!entry || entry.resetAt < now) {
    // New window
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  entry.count++
  if (entry.count > maxRequests) {
    return false // Rate limited
  }

  return true
}

/**
 * Route-handler guard for public endpoints that hit external APIs (FareHarbor)
 * or write to the database. Returns a 429 response when the caller's IP is over
 * the limit, or null when the request may proceed.
 *
 * Usage — first line of the handler:
 *   const limited = enforceRateLimit(request, 'promo-validate', 10, 60_000)
 *   if (limited) return limited
 */
export function enforceRateLimit(
  request: NextRequest,
  namespace: string,
  maxRequests: number,
  windowMs: number,
): NextResponse | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (checkRateLimit(ip, namespace, maxRequests, windowMs)) return null
  return NextResponse.json(
    { ok: false, error: 'Too many requests — please slow down and try again shortly.' },
    { status: 429, headers: getRateLimitHeaders(ip, namespace, maxRequests) },
  )
}

/**
 * Get rate limit headers for the response.
 */
export function getRateLimitHeaders(ip: string, namespace: string, maxRequests: number): Record<string, string> {
  const key = `${namespace}:${ip}`
  const entry = windows.get(key)
  const remaining = entry ? Math.max(0, maxRequests - entry.count) : maxRequests

  return {
    'X-RateLimit-Limit': String(maxRequests),
    'X-RateLimit-Remaining': String(remaining),
  }
}
