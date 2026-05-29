'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { Loader2, ArrowLeft, Check, CheckCircle2 } from 'lucide-react'
import { quarterLabel } from '@/lib/quarters'
import { fmtEuros } from '@/lib/utils'

interface Partner {
  id: string
  name: string
  email: string | null
  contact_name: string | null
  phone: string | null
  website: string | null
  commission_rate: number
  is_active: boolean
  created_at: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface QuarterTotals {
  quarter: string
  bookingCount: number
  baseAmountCents: number
  commissionAmountCents: number
  netAmountCents: number
  settled: boolean
  settledAt: string | null
  paidAmountCents: number | null
  settlementId: string | null
}

interface SettlementSummary {
  partnerInvoice: QuarterTotals[]
  affiliate: QuarterTotals[]
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: partnerData, isLoading: loadingPartner, refresh: refreshPartner } =
    useAdminFetch<{ partner: Partner }>(id ? `/api/admin/partners/${id}` : null)
  const { data: summary, isLoading: loadingSummary, refresh: refreshSummary } =
    useAdminFetch<SettlementSummary>(id ? `/api/admin/partners/${id}/settlement-summary` : null)

  const partner = partnerData?.partner ?? null
  const loading = loadingPartner || loadingSummary

  const [settlingKey, setSettlingKey] = useState<string | null>(null)

  function fetchData() {
    refreshPartner()
    refreshSummary()
  }

  async function markSettled(quarter: string, type: 'partner_invoice' | 'affiliate', amountCents: number) {
    const key = `${quarter}::${type}`
    setSettlingKey(key)
    try {
      const res = await fetch(`/api/admin/partners/${id}/settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter, settlementType: type, amountCents }),
      })
      const json = await res.json()
      if (!json.ok) {
        alert(json.error ?? 'Could not mark settled')
      } else {
        fetchData()
      }
    } finally {
      setSettlingKey(null)
    }
  }

  async function undoSettlement(settlementId: string) {
    if (!confirm('Undo this settlement record? The bookings stay; only the settlement marker is removed.')) return
    try {
      const res = await fetch(`/api/admin/partners/${id}/settlements/${settlementId}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) fetchData()
      else alert(json.error ?? 'Could not undo settlement')
    } catch {
      alert('Network error')
    }
  }

  if (loading) {
    return <div className="p-8 flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading partner…</div>
  }
  if (!partner) {
    return <div className="p-8 text-sm text-zinc-500">Partner not found.</div>
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <Link href="/en/admin/partners" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to partners
      </Link>

      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">{partner.name}</h1>
        {partner.email && <p className="text-sm text-zinc-500 mt-0.5">{partner.email}</p>}
      </header>

      <p className="text-xs text-zinc-400 leading-relaxed">
        <strong>How this works:</strong> partner deals run through <Link href="/en/admin/promo-codes" className="underline hover:text-zinc-700">promo codes</Link> scoped to a <Link href="/en/admin/campaigns" className="underline hover:text-zinc-700">campaign</Link>. Create a campaign linking this partner to a listing with the agreed commission %. Then issue a 4-letter promo code locked to that campaign — bookings auto-attribute commission here.
      </p>

      {/* Settlements section — always visible once data is loaded */}
      <div className="mt-8 space-y-6">
        {!summary ? (
          <div className="flex items-center gap-2 text-zinc-400 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settlements…
          </div>
        ) : summary.partnerInvoice.length === 0 && summary.affiliate.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-8 text-center text-sm text-zinc-400">
            No bookings attributed to this partner yet. Settlements will appear here once bookings come in.
          </div>
        ) : (
          <>
            {summary.partnerInvoice.length > 0 && (
              <SettlementTable
                title="Partner-invoice settlements"
                subtitle="Partner collected ticket prices on the desk and owes Off Course the net (ticket – commission). Settle each quarter."
                rows={summary.partnerInvoice}
                type="partner_invoice"
                owesLabel="Partner owes us"
                onMarkSettled={markSettled}
                onUndo={undoSettlement}
                settlingKey={settlingKey}
              />
            )}
            {summary.affiliate.length > 0 && (
              <SettlementTable
                title="Affiliate settlements"
                subtitle="Off Course collected the ticket price online; we owe the partner their commission. Settle each quarter."
                rows={summary.affiliate}
                type="affiliate"
                owesLabel="We owe partner"
                onMarkSettled={markSettled}
                onUndo={undoSettlement}
                settlingKey={settlingKey}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface SettlementTableProps {
  title: string
  subtitle: string
  rows: QuarterTotals[]
  type: 'partner_invoice' | 'affiliate'
  owesLabel: string
  onMarkSettled: (quarter: string, type: 'partner_invoice' | 'affiliate', amountCents: number) => void
  onUndo: (settlementId: string) => void
  settlingKey: string | null
}

function SettlementTable({ title, subtitle, rows, type, owesLabel, onMarkSettled, onUndo, settlingKey }: SettlementTableProps) {
  return (
    <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100">
        <h2 className="font-semibold text-zinc-900">{title}</h2>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 border-b border-zinc-100">
            <th className="text-left px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Quarter</th>
            <th className="text-right px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Bookings</th>
            <th className="text-right px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Tickets</th>
            <th className="text-right px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">{owesLabel}</th>
            <th className="text-right px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Status</th>
            <th className="px-5 py-2 w-32" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map(r => {
            const key = `${r.quarter}::${type}`
            const settling = settlingKey === key
            return (
              <tr key={key} className="hover:bg-zinc-50">
                <td className="px-5 py-3 text-zinc-900">{quarterLabel(r.quarter)}</td>
                <td className="px-5 py-3 text-right text-zinc-700">{r.bookingCount}</td>
                <td className="px-5 py-3 text-right text-zinc-700">{fmtEuros(r.baseAmountCents)}</td>
                <td className="px-5 py-3 text-right font-semibold text-zinc-900">{fmtEuros(r.netAmountCents)}</td>
                <td className="px-5 py-3 text-right">
                  {r.settled ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                      Settled {r.settledAt ? fmtDate(r.settledAt) : ''}
                    </span>
                  ) : r.bookingCount === 0 ? (
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-zinc-500 bg-zinc-100 rounded-full">In progress</span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-100 rounded-full">Outstanding</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {r.settled && r.settlementId ? (
                    <button
                      onClick={() => onUndo(r.settlementId!)}
                      className="text-xs text-zinc-400 hover:text-red-600 underline"
                    >
                      Undo
                    </button>
                  ) : r.bookingCount > 0 ? (
                    <button
                      onClick={() => onMarkSettled(r.quarter, type, r.netAmountCents)}
                      disabled={settling}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 rounded-lg disabled:opacity-50"
                    >
                      {settling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Mark settled
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
