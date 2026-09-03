'use client'

import { useState } from 'react'
import { 
  FileText, 
  ExternalLink, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Building2, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  Copy,
  Loader2
} from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminAmount, fmtAdminDate } from '@/lib/admin/format'
import type { FinanceInvoicesResponse, InvoiceFinanceItem } from '@/app/api/admin/finance/invoices/route'

export function InvoicesTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<FinanceInvoicesResponse>('/api/admin/finance/invoices')
  const [syncing, setSyncing] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showPaid, setShowPaid] = useState(false)
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch('/api/admin/finance/invoices?sync=true')
      await refresh()
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncing(false)
    }
  }

  async function handleMarkPaid(item: InvoiceFinanceItem) {
    if (!confirm(`Weet je zeker dat je factuur voor ${item.companyName || item.customerName} (€${(item.amountCents / 100).toFixed(2)}) als voldaan wilt markeren?`)) {
      return
    }
    setMarkingPaidId(item.id)
    try {
      const res = await fetch(`/api/admin/bookings/${item.id}/mark-invoice-paid`, {
        method: 'POST',
      })
      if (res.ok) {
        await refresh()
      } else {
        const json = await res.json()
        alert(json.error || 'Fout bij markeren als betaald')
      }
    } catch (err) {
      alert('Netwerkfout bij markeren als betaald')
    } finally {
      setMarkingPaidId(null)
    }
  }

  function handleCopy(url: string, id: string) {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span>Facturen laden…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span>{error || 'Fout bij ophalen van facturen'}</span>
      </div>
    )
  }

  const { openInvoices, paidInvoices, stats } = data

  return (
    <div className="space-y-6">
      {/* Top action bar with stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Open amount */}
        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-800 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              Openstaand Factuurbedrag
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 font-bold">
              {stats.openCount} open
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold text-zinc-900">
              {fmtAdminAmount(stats.openAmountCents)}
            </span>
            {stats.overdueCount > 0 && (
              <span className="text-xs text-red-600 block mt-1 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {stats.overdueCount} vervallen factuur
              </span>
            )}
          </div>
        </div>

        {/* Paid amount */}
        <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-800 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Geïnd via Factuur (B2B)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900 font-bold">
              {stats.paidCount} voldaan
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold text-zinc-900">
              {fmtAdminAmount(stats.paidAmountCents)}
            </span>
          </div>
        </div>

        {/* Sync / Actions */}
        <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col justify-between">
          <div className="text-xs font-semibold text-zinc-600">
            Stripe Virtual IBAN Reconciliatie
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Inkomende bankoverschrijvingen worden automatisch gekoppeld zodra de banken hebben verwerkt.
          </p>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="mt-3 self-start px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-700 flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Synchroniseren met Stripe…' : 'Check Stripe status'}
          </button>
        </div>
      </div>

      {/* Open Invoices Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-zinc-900">Openstaande Facturen</h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
              {openInvoices.length}
            </span>
          </div>
        </div>

        {openInvoices.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            Geen openstaande facturen op dit moment 🎉
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-100 text-zinc-500 font-medium">
                  <th className="py-3 px-4">Bedrijf / Klant</th>
                  <th className="py-3 px-4">Vaartocht</th>
                  <th className="py-3 px-4">Vervaldatum</th>
                  <th className="py-3 px-4">Bedrag</th>
                  <th className="py-3 px-4">Factuur Link</th>
                  <th className="py-3 px-4 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {openInvoices.map(inv => {
                  return (
                    <tr key={inv.id} className="hover:bg-amber-50/20 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-zinc-900 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-zinc-400" />
                          {inv.companyName || inv.customerName}
                        </div>
                        <div className="text-zinc-500 text-[11px] mt-0.5">
                          {inv.companyKvk && <span className="mr-2 font-mono">KVK: {inv.companyKvk}</span>}
                          <span>{inv.customerEmail}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-zinc-900 font-medium">{inv.listingTitle || 'Tour'}</div>
                        <div className="text-zinc-500 text-[11px] mt-0.5">
                          Tourdatum: {inv.bookingDate ? fmtAdminDate(inv.bookingDate) : '—'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-zinc-900">
                          {inv.invoiceDueDate ? fmtAdminDate(inv.invoiceDueDate) : '—'}
                        </div>
                        {inv.isOverdue ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 mt-1">
                            Vervallen
                          </span>
                        ) : inv.daysUntilDue != null ? (
                          <span className="text-[10px] text-zinc-500 mt-0.5 block">
                            Over {inv.daysUntilDue} {inv.daysUntilDue === 1 ? 'dag' : 'dagen'}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-zinc-900 text-sm">
                          {fmtAdminAmount(inv.amountCents)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block font-normal">incl. BTW</span>
                      </td>
                      <td className="py-3.5 px-4">
                        {inv.stripeInvoiceUrl ? (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={inv.stripeInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium transition-colors"
                            >
                              <span>Bekijk Factuur</span>
                              <ExternalLink className="w-3 h-3 text-zinc-400" />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleCopy(inv.stripeInvoiceUrl!, inv.id)}
                              className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
                              title="Kopieer factuurlink"
                            >
                              {copiedId === inv.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleMarkPaid(inv)}
                          disabled={markingPaidId === inv.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80 transition-colors disabled:opacity-50"
                        >
                          {markingPaidId === inv.id ? 'Bezig…' : 'Markeer betaald'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paid Invoices Collapsible Section */}
      {paidInvoices.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-xs">
          <button
            type="button"
            onClick={() => setShowPaid(!showPaid)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-zinc-50/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-semibold text-zinc-900">Betaalde Facturen (Historie)</h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                {paidInvoices.length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <span className="text-xs">{showPaid ? 'Inklappen' : 'Uitklappen'}</span>
              {showPaid ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {showPaid && (
            <div className="overflow-x-auto border-t border-zinc-100">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-100 text-zinc-500 font-medium">
                    <th className="py-3 px-4">Bedrijf / Klant</th>
                    <th className="py-3 px-4">Vaartocht</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Bedrag</th>
                    <th className="py-3 px-4 text-right">Factuur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {paidInvoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-zinc-50/50">
                      <td className="py-3 px-4">
                        <div className="font-medium text-zinc-900">{inv.companyName || inv.customerName}</div>
                        <div className="text-zinc-400 text-[11px]">{inv.customerEmail}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-zinc-900">{inv.listingTitle}</div>
                        <div className="text-zinc-400 text-[11px]">{inv.bookingDate ? fmtAdminDate(inv.bookingDate) : '—'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          <Check className="w-3 h-3" /> Voldaan
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-zinc-900">
                        {fmtAdminAmount(inv.amountCents)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {inv.stripeInvoiceUrl && (
                          <a
                            href={inv.stripeInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-500 hover:text-zinc-900 underline inline-flex items-center gap-1"
                          >
                            <span>Factuur</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
