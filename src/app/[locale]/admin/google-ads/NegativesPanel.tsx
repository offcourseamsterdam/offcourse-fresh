'use client'

import { useState, useEffect } from 'react'
import { Loader2, Ban, CheckCircle2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { SearchTermRow } from '@/lib/google-ads/reporting'

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-zinc-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg whitespace-nowrap">
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      {message}
    </div>
  )
}

export function NegativesPanel({
  campaignId,
  demo,
  onBlocked,
}: {
  campaignId: string
  demo: boolean
  onBlocked: () => void
}) {
  const url = `/api/admin/google-ads/search-terms?campaign=${campaignId}&days=30${demo ? '&demo=1' : ''}`
  const { data, isLoading } = useAdminFetch<{ terms: SearchTermRow[] }>(url)
  const [blocking, setBlocking] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function block(term: string) {
    if (demo) {
      setErr('Demo mode — actions are disabled.')
      return
    }
    setBlocking(term)
    setErr(null)
    try {
      const res = await fetch('/api/admin/google-ads/negatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, terms: [term] }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed to block')
      // Remove immediately from the list — no waiting for a re-fetch
      setBlocked(prev => new Set([...prev, term]))
      setToast(`"${term}" blocked`)
      onBlocked()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBlocking(null)
    }
  }

  const terms = (data?.terms ?? []).filter(t => !blocked.has(t.term))

  return (
    <>
      <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3">
        <p className="text-xs text-zinc-500 mb-2">
          Real searches that triggered this ad. Block the junk — it stops wasting money on the wrong clicks.
        </p>

        {isLoading && !data && (
          <div className="flex justify-center py-3 text-zinc-300"><Loader2 className="w-4 h-4 animate-spin" /></div>
        )}

        {data && terms.length === 0 && <p className="text-xs text-zinc-400">No search terms recorded yet.</p>}

        <ul className="space-y-1">
          {terms.map(t => (
            <li key={t.term} className="flex items-center justify-between gap-2 text-xs py-1">
              <span className="truncate text-zinc-700">{t.term}</span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span className="text-zinc-400 tabular-nums hidden sm:inline">
                  {t.clicks} clicks · {t.conversions > 0 ? `${Math.round(t.conversions)} booked` : '0 booked'} · €{Math.round(t.costEuros)}
                </span>
                <button
                  onClick={() => block(t.term)}
                  disabled={blocking === t.term}
                  className="inline-flex items-center gap-1 px-2 min-h-[32px] rounded-md border border-zinc-200 bg-white text-zinc-600 hover:text-red-600 hover:border-red-200 disabled:opacity-50"
                >
                  {blocking === t.term ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                  Block
                </button>
              </span>
            </li>
          ))}
        </ul>

        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </>
  )
}
