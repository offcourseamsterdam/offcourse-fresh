'use client'

import { useState } from 'react'
import { CalendarSearch, Loader2, X } from 'lucide-react'
import { adminFetcher } from '@/hooks/useAdminFetch'
import { locales } from '@/lib/i18n/config'

interface SlotResult {
  listing: { slug: string; title: string; category: string | null }
  availableSlots: { startTime: string }[]
}

interface Props {
  /** Customer's locale (from the contact) — the link opens the site in their language. */
  customerLocale: string | null
  /** Called with the ready-to-send URL when the admin picks a slot. */
  onPick: (url: string) => void
  onClose: () => void
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

/**
 * The inbox's availability finder — same /api/search the website hero uses,
 * so what the admin sees is exactly what the customer will see when they
 * open the link (3-layer filters included). Picking a slot builds a
 * pre-filled cruise URL: date, guests and time all selected on arrival.
 */
export function AvailabilityFinder({ customerLocale, onPick, onClose }: Props) {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' }))
  const [guests, setGuests] = useState(2)
  const [results, setResults] = useState<SlotResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locale = customerLocale && (locales as readonly string[]).includes(customerLocale) ? customerLocale : 'en'

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { results } = await adminFetcher<{ results: SlotResult[] }>(`/api/search?date=${date}&guests=${guests}`)
      setResults(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  function pick(slug: string, time?: string) {
    const url = `${SITE_URL}/${locale}/cruises/${slug}?date=${date}&guests=${guests}${time ? `&time=${encodeURIComponent(time)}` : ''}`
    onPick(url)
  }

  const withSlots = results?.filter(r => r.availableSlots.length > 0) ?? []

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-700 inline-flex items-center gap-1.5">
          <CalendarSearch className="w-3.5 h-3.5" /> Find availability
          <span className="font-normal text-zinc-400">— link opens pre-filled in {locale.toUpperCase()}</span>
        </p>
        <button onClick={onClose} className="p-1 rounded hover:bg-zinc-200 text-zinc-400" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <form onSubmit={search} className="flex items-end gap-2">
        <label className="text-[10px] text-zinc-500 flex-1">
          Date
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
            className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm bg-white"
          />
        </label>
        <label className="text-[10px] text-zinc-500 w-20">
          Guests
          <input
            type="number"
            min={1}
            max={12}
            value={guests}
            onChange={e => setGuests(Number(e.target.value))}
            className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-zinc-900 text-white px-3 py-2 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Search
        </button>
      </form>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {results && !busy && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {withSlots.length === 0 && (
            <p className="text-xs text-zinc-400">Nothing free on {date} for {guests} guests.</p>
          )}
          {withSlots.map(r => (
            <div key={r.listing.slug} className="bg-white rounded-md border border-zinc-200 px-2.5 py-2">
              <p className="text-xs font-medium text-zinc-800 mb-1.5">
                {r.listing.title}
                {r.listing.category && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-wide text-zinc-400">{r.listing.category}</span>
                )}
              </p>
              <div className="flex flex-wrap gap-1">
                {r.availableSlots.map(s => (
                  <button
                    key={s.startTime}
                    onClick={() => pick(r.listing.slug, s.startTime)}
                    className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2 py-0.5 rounded-full hover:bg-indigo-600 hover:text-white transition-colors"
                  >
                    {s.startTime}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
