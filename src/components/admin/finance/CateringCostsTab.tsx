'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  UtensilsCrossed,
  ArrowUpRight,
  TrendingUp,
  Package,
  Sliders,
  DollarSign
} from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminAmount } from '@/lib/admin/format'
import type { ProfitCockpitResponse } from './ProfitCockpitTab'

export function CateringCostsTab() {
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)

  const { data, isLoading, error } = useAdminFetch<ProfitCockpitResponse>(
    `/api/admin/finance/profit-cockpit?year=${selectedYear}`
  )

  if (isLoading && !data) {
    return (
      <div className="py-16 text-center text-sm text-zinc-500">
        Cateringkosten en marges berekenen...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl">
        Fout bij het laden van catering-inzichten: {error}
      </div>
    )
  }

  const { months, totals } = data
  const monthsWithCatering = months.filter(m => m.cateringSellingCents > 0 || m.cateringCostCents > 0)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-zinc-800" />
            <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Catering Inkoop &amp; Brutomarges</h2>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Volledig inzicht in cateringverkoop, inkoopkosten (COGS) en gerealiseerde marge op eten &amp; drinken.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/extras"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 hover:bg-zinc-50 shadow-sm transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-500" />
            Inkoopprijzen Beheren (/extras)
            <ArrowUpRight className="w-3 h-3 text-zinc-400" />
          </Link>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-1">
          <span className="text-xs font-medium text-zinc-500">Totale Catering Verkoop ({selectedYear})</span>
          <div className="text-2xl font-bold text-zinc-900">
            {fmtAdminAmount(totals.totalCateringSellingCents)}
          </div>
          <p className="text-[11px] text-zinc-400">Bruto omzet uit eten &amp; drank</p>
        </div>

        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-1">
          <span className="text-xs font-medium text-zinc-500">Totale Inkoopkosten (COGS)</span>
          <div className="text-2xl font-bold text-zinc-800">
            − {fmtAdminAmount(totals.totalCateringCostCents)}
          </div>
          <p className="text-[11px] text-zinc-400">Wat betaald is aan cateraars/inkoop</p>
        </div>

        <div className="bg-white rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800">Catering Brutowinst</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900">
              {totals.overallCateringMarginPct}% Marge
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-700">
            {fmtAdminAmount(totals.totalCateringSellingCents - totals.totalCateringCostCents)}
          </div>
          <p className="text-[11px] text-emerald-800/70">Netto winstbijdrage van catering</p>
        </div>
      </div>

      {/* ── Maandtabel ── */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-200 bg-zinc-50/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900">Catering Marge per Maand ({selectedYear})</h3>
          <span className="text-xs text-zinc-500">{monthsWithCatering.length} actieve cateringmaanden</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-100/70 border-b border-zinc-200 text-zinc-600 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="px-4 py-3">Maand</th>
                <th className="px-4 py-3 text-right">Catering Verkoop</th>
                <th className="px-4 py-3 text-right">Inkoopkosten</th>
                <th className="px-4 py-3 text-right">Brutomarge (€)</th>
                <th className="px-4 py-3 text-right">Marge %</th>
                <th className="px-4 py-3 text-right">Aandeel in Maandomzet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {months.map(m => {
                const shareOfRev = m.totalRevenueCents > 0
                  ? Math.round((m.cateringSellingCents / m.totalRevenueCents) * 100)
                  : 0

                return (
                  <tr key={m.month} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-zinc-900">
                      {m.monthLabel}
                      {m.isCurrentMonth && (
                        <span className="ml-2 text-[10px] font-medium px-1.5 py-0.2 rounded bg-blue-100 text-blue-800">
                          Actueel
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-zinc-900">
                      {m.cateringSellingCents > 0 ? fmtAdminAmount(m.cateringSellingCents) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-700">
                      {m.cateringCostCents > 0 ? `− ${fmtAdminAmount(m.cateringCostCents)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">
                      {m.cateringMarginCents > 0 ? fmtAdminAmount(m.cateringMarginCents) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {m.cateringSellingCents > 0 ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          m.cateringMarginPct >= 50 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {m.cateringMarginPct}%
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500">
                      {shareOfRev > 0 ? `${shareOfRev}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-zinc-100/90 font-bold border-t border-zinc-300 text-zinc-900">
              <tr>
                <td className="px-4 py-3">TOTAAL {selectedYear}</td>
                <td className="px-4 py-3 text-right">{fmtAdminAmount(totals.totalCateringSellingCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-700">− {fmtAdminAmount(totals.totalCateringCostCents)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{fmtAdminAmount(totals.totalCateringSellingCents - totals.totalCateringCostCents)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{totals.overallCateringMarginPct}%</td>
                <td className="px-4 py-3 text-right">
                  {totals.totalRevenueCents > 0 ? `${Math.round((totals.totalCateringSellingCents / totals.totalRevenueCents) * 100)}%` : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
