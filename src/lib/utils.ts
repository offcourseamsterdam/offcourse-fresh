import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Locale } from './i18n/config'

// ── Class name helper (clsx + tailwind-merge for shadcn) ─────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Price formatting ─────────────────────────────────────────────────────────

/** Format cents as €X.XX (e.g. 1650 → "€16.50") */
export function fmtEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
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
  return new Intl.DateTimeFormat(locale, options).format(d)
}

export function formatShortDate(date: Date | string, locale: Locale = 'en'): string {
  return formatDate(date, locale, { day: 'numeric', month: 'short', year: 'numeric' })
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
