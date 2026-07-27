import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Locale } from './i18n/config'

// ── Class name helper (clsx + tailwind-merge for shadcn) ─────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Price formatting ─────────────────────────────────────────────────────────

/** Format cents as €X.XX (e.g. 1650 → "€16.50", -500 → "-€5.00") */
export function fmtEuros(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}€${(Math.abs(cents) / 100).toFixed(2)}`
}

export function formatPrice(
  cents: number,
  locale: Locale = 'en',
  currency = 'EUR'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

// ── Date formatting ──────────────────────────────────────────────────────────

export function formatDate(
  date: Date | string,
  locale: Locale = 'en',
  options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // Amsterdam is always ahead of UTC (+1/+2h), so a bare "YYYY-MM-DD" string
  // (parsed as UTC midnight) still falls on the same Amsterdam calendar day —
  // this makes the date display correctly for any viewer's browser timezone
  // without needing to pre-shift the input to noon before calling this.
  return new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Amsterdam', ...options }).format(d)
}

export function formatShortDate(date: Date | string, locale: Locale = 'en'): string {
  return formatDate(date, locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "June 2026" style, for a review's publish_time. Returns '' for null or an unparseable date. */
export function formatReviewMonthYear(publishTime: string | null): string {
  if (!publishTime) return ''
  try {
    return new Date(publishTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

// ── Duration formatting ──────────────────────────────────────────────────────

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// ── Listing helpers ─────────────────────────────────────────────────────

export function categorizeListings<T extends { category: string | null }>(
  listings: T[]
): { private: T[]; shared: T[] } {
  return {
    private: listings.filter(l => l.category === 'private'),
    shared: listings.filter(l => l.category === 'shared'),
  }
}

// ── Slug helpers ─────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ── Shared date helpers ─────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD string */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Get today at midnight */
export function getToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Amsterdam-local YYYY-MM-DD for a given instant (defaults to now). Safe to
 * use in server code (which runs in UTC on Vercel) to compute "today" or a
 * booking's calendar date — unlike `toISOString().slice(0,10)` (reads the UTC
 * date, which is the wrong calendar day for roughly the first 1-2 hours after
 * Amsterdam midnight) or the `'T12:00:00'` workaround reinvented at several
 * call sites to dodge the same problem.
 */
export function toAmsDateStr(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })
}

// ── Price formatting (rounded) ──────────────────────────────────────────────

/** Format cents as €X (no decimals, e.g. 16500 → "€165", -16500 → "-€165") */
export function fmtEurosRounded(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}€${Math.round(Math.abs(cents) / 100)}`
}

// ── Error handling ──────────────────────────────────────────────────────────

/** Extract error message from unknown catch value */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}


// ── HTML escaping ─────────────────────────────────────────────────────────────

/** Escape HTML-special chars for safe interpolation into HTML (e.g. email templates). */
export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Amsterdam timezone formatting ─────────────────────────────────────────────

/** Format an ISO datetime (or Date) as HH:MM in Amsterdam time (nl-NL). Returns '—' for null/undefined. */
export function formatAmsterdamTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}
