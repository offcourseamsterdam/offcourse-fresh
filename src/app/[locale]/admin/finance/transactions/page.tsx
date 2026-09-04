'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Landmark, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { adminInputClass } from '@/components/admin/ui/fields'
import { useAdminFetch, adminFetcher } from '@/hooks/useAdminFetch'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { TransactionList } from '@/components/admin/finance/cockpit/TransactionList'
import { REVOLUT_API } from '@/components/admin/finance/cockpit/RevolutConnectCard'
import {
  COCKPIT_API,
  type RevolutStatus,
  type TransactionApiRow,
  type TransactionsResponse,
} from '@/components/admin/finance/cockpit/api-types'
import { dateTimeNL } from '@/components/admin/finance/cockpit/money'

const PAGE_SIZE = 50

/** The API filters on one Revolut state at a time, so the select mirrors Revolut's own list. */
const STATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alle statussen' },
  { value: 'pending', label: 'In behandeling' },
  { value: 'created', label: 'Aangemaakt' },
  { value: 'completed', label: 'Afgerond' },
  { value: 'declined', label: 'Geweigerd' },
  { value: 'failed', label: 'Mislukt' },
  { value: 'reverted', label: 'Teruggedraaid' },
]

type Direction = '' | 'in' | 'out'
const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: '', label: 'In + uit' },
  { value: 'in', label: 'Binnenkomend' },
  { value: 'out', label: 'Uitgaand' },
]

function buildUrl(f: { state: string; direction: Direction; needsReview: boolean; q: string; before?: string | null }): string {
  const p = new URLSearchParams()
  p.set('limit', String(PAGE_SIZE))
  if (f.state) p.set('state', f.state)
  if (f.direction) p.set('direction', f.direction)
  if (f.needsReview) p.set('needs_review', 'true')
  if (f.q) p.set('q', f.q)
  if (f.before) p.set('before', f.before)
  return `${COCKPIT_API}/transactions?${p.toString()}`
}

/** Pages loaded via "Meer laden", keyed by the filter URL they belong to so a filter change drops them. */
interface ExtraPages {
  forUrl: string
  rows: TransactionApiRow[]
  nextBefore: string | null
}

export default function FinanceTransactionsPage() {
  const params = useParams()
  const locale = (params?.locale as string | undefined) ?? 'en'

  const [state, setState] = useState('')
  const [direction, setDirection] = useState<Direction>('')
  const [needsReview, setNeedsReview] = useState(false)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  // Debounce the text search so each keystroke doesn't hit Supabase.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: revolut } = useAdminFetch<RevolutStatus>(`${REVOLUT_API}/status`)
  const connected = revolut?.connected === true

  const firstUrl = buildUrl({ state, direction, needsReview, q })
  const { data, isLoading, error } = useAdminFetch<TransactionsResponse>(firstUrl)

  const [extra, setExtra] = useState<ExtraPages | null>(null)
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)

  const extraRows = extra?.forUrl === firstUrl ? extra.rows : []
  const nextBefore = extra?.forUrl === firstUrl ? extra.nextBefore : (data?.nextBefore ?? null)
  const rows = [...(data?.transactions ?? []), ...extraRows]

  async function loadMore() {
    if (!nextBefore) return
    setLoadingMore(nextBefore)
    setMoreError(null)
    try {
      const page = await adminFetcher<TransactionsResponse>(buildUrl({ state, direction, needsReview, q, before: nextBefore }))
      setExtra(prev => ({
        forUrl: firstUrl,
        rows: [...(prev?.forUrl === firstUrl ? prev.rows : []), ...page.transactions],
        nextBefore: page.nextBefore,
      }))
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : 'Kon niet meer laden.')
    } finally {
      setLoadingMore(null)
    }
  }

  const filtersActive = Boolean(state || direction || needsReview || q)

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <FinanceSubnav />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900">Transacties</h1>
          <p className="text-sm text-zinc-500 mt-1">Alles wat er op de Revolut-rekening gebeurt, nieuwste eerst.</p>
          {connected && (
            <p className="text-xs text-zinc-400 mt-1">
              Laatste synchronisatie: {dateTimeNL(revolut?.lastSyncAt)}
              {revolut?.lastSyncError && <span className="text-red-600"> · {revolut.lastSyncError}</span>}
            </p>
          )}
        </div>
      </div>

      <AdminErrorBanner error={error ?? moreError} />

      {/* Filter bar */}
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">Zoeken</span>
          <span className="relative block">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Omschrijving of referentie"
              className={`${adminInputClass} pl-9 min-h-[44px] sm:min-h-0`}
            />
          </span>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">Status</span>
          <select value={state} onChange={e => setState(e.target.value)} className={`${adminInputClass} min-h-[44px] sm:min-h-0`}>
            {STATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">Richting</span>
          <select value={direction} onChange={e => setDirection(e.target.value as Direction)} className={`${adminInputClass} min-h-[44px] sm:min-h-0`}>
            {DIRECTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setNeedsReview(v => !v)}
          aria-pressed={needsReview}
          className={`inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[38px] px-3.5 rounded-lg border text-sm font-medium transition-colors ${
            needsReview ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${needsReview ? 'bg-amber-500' : 'bg-zinc-300'}`} />
          Controle nodig
        </button>
      </div>

      {/* List */}
      {!data && isLoading ? (
        <AdminPageSkeleton />
      ) : !connected && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center space-y-3">
          <Landmark className="w-6 h-6 text-zinc-300 mx-auto" />
          <p className="text-sm text-zinc-600">Revolut is nog niet gekoppeld, dus er zijn nog geen transacties om te tonen.</p>
          <Button asChild size="sm">
            <Link href={`/${locale}/admin/finance/overview?revolut=open`}>Koppel Revolut op het overzicht</Link>
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">
            {filtersActive ? 'Geen transacties die aan deze filters voldoen.' : 'Nog geen transacties gesynchroniseerd. Klik op "Ververs" op het overzicht.'}
          </p>
        </div>
      ) : (
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
          <TransactionList transactions={rows} />
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-100 flex-wrap">
            <p className="text-xs text-zinc-400">{rows.length} {rows.length === 1 ? 'transactie' : 'transacties'} geladen{nextBefore ? ', er zijn er meer' : ''}</p>
            {nextBefore && (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore != null} className="min-h-[44px] sm:min-h-0">
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Meer laden
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
