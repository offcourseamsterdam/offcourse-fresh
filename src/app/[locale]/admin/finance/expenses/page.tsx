'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { adminInputClass } from '@/components/admin/ui/fields'
import { useAdminFetch, adminFetcher } from '@/hooks/useAdminFetch'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { EXPENSE_STATUS_LABELS, type ExpenseStatus } from '@/lib/finance/expenses/status'
import { EXPENSES_API, type ExpenseApiRow, type ExpensesResponse, type ExpenseSummaryResponse } from '@/components/admin/finance/expenses/api-types'
import { ExpenseRowItem } from '@/components/admin/finance/expenses/ExpenseRow'
import { ExpenseDrawer } from '@/components/admin/finance/expenses/ExpenseDrawer'
import { VatPositionCards } from '@/components/admin/finance/expenses/VatPositionCards'

const PAGE_SIZE = 50

/** The filter chips: the statuses that need Beer, in the order they need him. */
const CHIP_STATUSES: Array<ExpenseStatus | 'open'> = ['open', 'needs_review', 'partially_matched', 'waiting_for_invoice', 'waiting_for_payment', 'ready_for_snelstart', 'sent_to_snelstart']

function buildUrl(f: { status: string; q: string; before?: string | null }): string {
  const p = new URLSearchParams()
  p.set('limit', String(PAGE_SIZE))
  if (f.status) p.set('status', f.status)
  if (f.q) p.set('q', f.q)
  if (f.before) p.set('before', f.before)
  return `${EXPENSES_API}?${p.toString()}`
}

interface ExtraPages { forUrl: string; rows: ExpenseApiRow[]; nextBefore: string | null }

export default function FinanceExpensesPage() {
  const [status, setStatus] = useState<string>('open')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: summary, mutate: refreshSummary } = useAdminFetch<ExpenseSummaryResponse>(`${EXPENSES_API}/summary`)
  const firstUrl = buildUrl({ status, q })
  const { data, isLoading, error, mutate } = useAdminFetch<ExpensesResponse>(firstUrl)

  const [extra, setExtra] = useState<ExtraPages | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const extraRows = extra?.forUrl === firstUrl ? extra.rows : []
  const nextBefore = extra?.forUrl === firstUrl ? extra.nextBefore : (data?.nextBefore ?? null)
  const rows = [...(data?.expenses ?? []), ...extraRows]

  async function loadMore() {
    if (!nextBefore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await adminFetcher<ExpensesResponse>(buildUrl({ status, q, before: nextBefore }))
      setExtra(prev => ({ forUrl: firstUrl, rows: [...(prev?.forUrl === firstUrl ? prev.rows : []), ...page.expenses], nextBefore: page.nextBefore }))
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : 'Kon niet meer laden.')
    } finally {
      setLoadingMore(false)
    }
  }

  const refresh = useCallback(() => {
    void mutate()
    void refreshSummary()
  }, [mutate, refreshSummary])
  const closeDrawer = useCallback(() => setSelected(null), [])

  const counts = summary?.counts

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <FinanceSubnav />

      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Uitgaven</h1>
        <p className="text-sm text-zinc-500 mt-1">Elke betaling met zijn factuur of bon, de BTW erop, en of het al bij de boekhouder ligt.</p>
      </div>

      <AdminErrorBanner error={error ?? moreError} />

      {summary && <VatPositionCards summary={summary} />}

      {/* Filter bar */}
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 sm:p-4 space-y-3">
        <label className="block">
          <span className="sr-only">Zoeken</span>
          <span className="relative block">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Leverancier, referentie, factuur- of ordernummer" className={`${adminInputClass} pl-9 min-h-[44px] sm:min-h-0`} />
          </span>
        </label>
        <div className="-mx-3 sm:mx-0 overflow-x-auto">
          <div className="flex items-center gap-2 px-3 sm:px-0 min-w-max">
            {CHIP_STATUSES.map(s => {
              const n = s === 'open' ? summary?.open : counts?.[s]
              const active = status === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(active && s !== 'open' ? 'open' : s)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors ${active ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}
                >
                  {s === 'open' ? 'Open' : EXPENSE_STATUS_LABELS[s]}
                  {n != null && <span className={`tabular-nums ${active ? 'text-zinc-300' : 'text-zinc-500'}`}>{n}</span>}
                </button>
              )
            })}
            <button type="button" onClick={() => setStatus('')} aria-pressed={status === ''} className={`inline-flex items-center min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap ${status === '' ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
              Alles
            </button>
          </div>
        </div>
      </div>

      {!data && isLoading ? (
        <AdminPageSkeleton />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">{q || status ? 'Geen uitgaven die aan deze filters voldoen.' : 'Nog geen uitgaven. Ze verschijnen zodra Revolut synchroniseert of een factuur op het factuuradres binnenkomt.'}</p>
        </div>
      ) : (
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-2 sm:p-3 space-y-2">
          <ul className="divide-y divide-zinc-100">
            {rows.map(e => <ExpenseRowItem key={e.id} expense={e} onSelect={row => setSelected(row.id)} />)}
          </ul>
          <div className="flex items-center justify-between gap-3 pt-2 px-2 border-t border-zinc-100 flex-wrap">
            <p className="text-xs text-zinc-400">{rows.length} {rows.length === 1 ? 'uitgave' : 'uitgaven'} geladen{nextBefore ? ', er zijn er meer' : ''}</p>
            {nextBefore && (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="min-h-[44px] sm:min-h-0">
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Meer laden
              </Button>
            )}
          </div>
        </section>
      )}

      <ExpenseDrawer expenseId={selected} onClose={closeDrawer} onChanged={refresh} />
    </div>
  )
}
