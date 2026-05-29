'use client'

import { useParams, useRouter } from 'next/navigation'
import { Loader2, RefreshCw, Receipt, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminAmountRounded } from '@/lib/admin/format'
import { quarterLabel } from '@/lib/quarters'

interface QuarterRow {
  quarter: string
  bookingCount: number
  partnerOwesUsCents: number
  weOwePartnerCents: number
  settledPartnerOwesUsCents: number
  settledWeOwePartnerCents: number
  outstandingPartnerOwesUsCents: number
  outstandingWeOwePartnerCents: number
}

interface PartnerRow {
  id: string
  name: string
  quarters: QuarterRow[]
  totalPartnerOwesUsCents: number
  totalWeOwePartnerCents: number
  outstandingPartnerOwesUsCents: number
  outstandingWeOwePartnerCents: number
}

interface FinanceData {
  partners: PartnerRow[]
  totals: {
    outstandingPartnerOwesUsCents: number
    outstandingWeOwePartnerCents: number
  }
}

export default function FinancePage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data, isLoading, error, refresh } =
    useAdminFetch<FinanceData>('/api/admin/finance/partners-summary')

  const partners = data?.partners ?? []
  const totals = data?.totals ?? { outstandingPartnerOwesUsCents: 0, outstandingWeOwePartnerCents: 0 }

  // Sort: partners with outstanding totals first
  const sorted = [...partners].sort((a, b) => {
    const aOut = a.outstandingPartnerOwesUsCents + a.outstandingWeOwePartnerCents
    const bOut = b.outstandingPartnerOwesUsCents + b.outstandingWeOwePartnerCents
    return bOut - aOut
  })

  return (
    <div className="p-8 max-w-none space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-emerald-500" />
            Finance
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Quarterly partner settlements · outstanding invoicing &amp; payouts at a glance
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      <AdminErrorBanner error={error} />

      {/* Top-level KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Partners owe us (outstanding)</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">
            {fmtAdminAmountRounded(totals.outstandingPartnerOwesUsCents)}
          </p>
          <p className="text-xs text-zinc-400 mt-1">To invoice this quarter / past quarters</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">We owe partners (outstanding)</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">
            {fmtAdminAmountRounded(totals.outstandingWeOwePartnerCents)}
          </p>
          <p className="text-xs text-zinc-400 mt-1">Affiliate commissions to pay out</p>
        </div>
      </div>

      {/* Loading */}
      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading finance overview…
        </div>
      )}

      {/* Empty */}
      {!isLoading && partners.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          No partner activity yet.
        </div>
      )}

      {/* Partners table */}
      {partners.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Partner</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Partner owes us</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">We owe partner</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Quarters</th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {sorted.map(p => (
                <tr
                  key={p.id}
                  className="hover:bg-zinc-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/${locale}/admin/partners/${p.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-zinc-900">{p.name}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {p.outstandingPartnerOwesUsCents > 0 ? (
                      <span className="font-semibold text-emerald-700">
                        {fmtAdminAmountRounded(p.outstandingPartnerOwesUsCents)}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {p.outstandingWeOwePartnerCents > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {fmtAdminAmountRounded(p.outstandingWeOwePartnerCents)}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {p.quarters.length === 0
                      ? <span className="text-zinc-300">No activity</span>
                      : p.quarters.map(q => (
                          <span
                            key={q.quarter}
                            className="inline-block mr-2 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600"
                          >
                            {quarterLabel(q.quarter)} ({q.bookingCount})
                          </span>
                        ))
                    }
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    <ArrowRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
