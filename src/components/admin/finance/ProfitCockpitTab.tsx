'use client'

import { useState } from 'react'
import {
  TrendingUp,
  Wallet,
  Wrench,
  Megaphone,
  Anchor,
  UtensilsCrossed,
  ShieldCheck,
  AlertCircle,
  Sliders,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Building2,
  Clock,
  Sparkles,
  ArrowUpRight,
  Info
} from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminAmount, fmtAdminAmountRounded } from '@/lib/admin/format'
import type { MonthlyCockpitRow, CockpitTotals, CockpitBudgetSettings } from '@/lib/finance/profit-cockpit-calculator'

export interface ProfitCockpitResponse {
  year: number
  months: MonthlyCockpitRow[]
  totals: CockpitTotals
  settings: CockpitBudgetSettings
  cash: {
    revolut: {
      configured: boolean
      totalEurCents: number
      primaryAccountName: string | null
    }
    effectiveBankCashCents: number
    openInvoicesCents: number
    currentMonthLiabilitiesCents: number
    totalPotsReservedCents: number
    freeAvailableCashCents: number
  }
}

export function ProfitCockpitTab() {
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  const { data, isLoading, error, refresh } = useAdminFetch<ProfitCockpitResponse>(
    `/api/admin/finance/profit-cockpit?year=${selectedYear}`
  )

  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    maintenancePct: 8,
    marketingPct: 6,
    winterBufferTargetEuros: 25000,
    monthlyRevenueTargetEuros: 40000,
    targetSkipperRatioPct: 18,
    defaultSkipperHourlyRateEuros: 35,
  })

  function openSettings() {
    if (data?.settings) {
      setSettingsForm({
        maintenancePct: data.settings.maintenancePct,
        marketingPct: data.settings.marketingPct,
        winterBufferTargetEuros: Math.round(data.settings.winterBufferTargetCents / 100),
        monthlyRevenueTargetEuros: Math.round(data.settings.defaultMonthlyRevenueTargetCents / 100),
        targetSkipperRatioPct: data.settings.targetSkipperRatioPct,
        defaultSkipperHourlyRateEuros: Math.round(data.settings.defaultSkipperHourlyRateCents / 100),
      })
    }
    setShowSettingsModal(true)
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    try {
      await fetch('/api/admin/finance/profit-cockpit/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maintenancePct: Number(settingsForm.maintenancePct),
          marketingPct: Number(settingsForm.marketingPct),
          winterBufferTargetCents: Number(settingsForm.winterBufferTargetEuros) * 100,
          defaultMonthlyRevenueTargetCents: Number(settingsForm.monthlyRevenueTargetEuros) * 100,
          targetSkipperRatioPct: Number(settingsForm.targetSkipperRatioPct),
          defaultSkipperHourlyRateCents: Number(settingsForm.defaultSkipperHourlyRateEuros) * 100,
        }),
      })
      await refresh()
      setShowSettingsModal(false)
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSavingSettings(false)
    }
  }

  if (isLoading && !data) {
    return (
      <div className="py-16 text-center text-sm text-zinc-500">
        Winst- en cashdata berekenen...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl">
        Fout bij het laden van de cockpit: {error}
      </div>
    )
  }

  const { months, totals, cash, settings } = data
  const currentMonthRow = months.find(m => m.isCurrentMonth) || months[months.length - 1]

  return (
    <div className="space-y-6">
      {/* ── Top Bar: Title, Year Switcher & Settings ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Winst & Cash Cockpit</h2>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Live Sturing
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Realtime inzicht in omzet, reële kosten (schipper, inkoop, commissies) en dynamische potjes.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex bg-zinc-100 p-0.5 rounded-lg text-xs font-semibold">
            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  selectedYear === y ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          <button
            onClick={openSettings}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 shadow-sm transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-500" />
            Potjes & Targets
          </button>
        </div>
      </div>

      {/* ── 1. Live Cash & Liquiditeit Banner ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-gradient-to-br from-zinc-900 via-zinc-850 to-zinc-900 text-white rounded-2xl p-5 shadow-xl">
        {/* Revolut Saldo */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-medium text-zinc-400">Revolut Banksaldo</span>
            {cash.revolut.configured ? (
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">Live</span>
            ) : (
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-zinc-700 text-zinc-300">Handmatig / Demo</span>
            )}
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {fmtAdminAmount(cash.effectiveBankCashCents)}
          </div>
          <p className="text-[11px] text-zinc-400">
            {cash.revolut.primaryAccountName || 'Direct beschikbaar op bank'}
          </p>
        </div>

        {/* Te ontvangen facturen */}
        <div className="space-y-1 md:border-l md:border-zinc-800 md:pl-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-medium text-zinc-400">Te Ontvangen (Facturen)</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-sky-300">
            + {fmtAdminAmount(cash.openInvoicesCents)}
          </div>
          <p className="text-[11px] text-zinc-400">
            Openstaande B2B Stripe facturen
          </p>
        </div>

        {/* Gereserveerd voor Schippers & Catering */}
        <div className="space-y-1 md:border-l md:border-zinc-800 md:pl-4">
          <div className="flex items-center gap-2">
            <Anchor className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-zinc-400">Operationeel Gereserveerd</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-amber-300">
            − {fmtAdminAmount(cash.currentMonthLiabilitiesCents)}
          </div>
          <p className="text-[11px] text-zinc-400">
            Schippersuren & catering deze maand
          </p>
        </div>

        {/* VRIJ BESCHIKBARE CASH */}
        <div className="space-y-1 bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3.5 md:border-l-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Vrij Beschikbaar</span>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black tracking-tight text-emerald-400">
            {fmtAdminAmount(cash.freeAvailableCashCents)}
          </div>
          <p className="text-[11px] text-emerald-300/80">
            Na aftrek van potjes & verplichtingen
          </p>
        </div>
      </div>

      {/* ── 2. KPI Cards & Doelen ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Doel van de Maand */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
            <span>Maandomzet ({currentMonthRow.monthLabel})</span>
            <span className="font-semibold text-zinc-900">{currentMonthRow.revenueTargetProgressPct}%</span>
          </div>
          <div className="text-xl font-bold text-zinc-900">
            {fmtAdminAmount(currentMonthRow.totalRevenueCents)}
          </div>
          <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                currentMonthRow.revenueTargetProgressPct >= 100 ? 'bg-emerald-500' : 'bg-blue-600'
              }`}
              style={{ width: `${Math.min(100, currentMonthRow.revenueTargetProgressPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Doel: {fmtAdminAmount(currentMonthRow.revenueTargetCents)}</span>
            <span>{currentMonthRow.bookingCount} vaarten</span>
          </div>
        </div>

        {/* Schipperskosten Ratio */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
            <span>Schippersratio</span>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
              totals.overallSkipperRatioPct <= settings.targetSkipperRatioPct
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              Target &lt; {settings.targetSkipperRatioPct}%
            </span>
          </div>
          <div className="text-xl font-bold text-zinc-900">
            {totals.overallSkipperRatioPct}%
            <span className="text-xs font-normal text-zinc-500 ml-2">
              ({fmtAdminAmount(totals.totalSkipperCostCents)})
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            {totals.totalHoursCruised} vaar-uren geregistreerd in {selectedYear}
          </p>
        </div>

        {/* Catering Brutomarge */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
            <span>Catering Brutomarge</span>
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
              Target &gt; {settings.targetCateringMarginPct}%
            </span>
          </div>
          <div className="text-xl font-bold text-zinc-900">
            {totals.overallCateringMarginPct}%
            <span className="text-xs font-normal text-zinc-500 ml-2">
              (marge {fmtAdminAmount(totals.totalCateringSellingCents - totals.totalCateringCostCents)})
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Verkoop {fmtAdminAmount(totals.totalCateringSellingCents)} · Inkoop {fmtAdminAmount(totals.totalCateringCostCents)}
          </p>
        </div>

        {/* Winst per Vaar-Uur */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
            <span>Netto Winst per Vaar-uur</span>
            <span className="text-xs text-zinc-400 font-normal">Na schipper & inkoop</span>
          </div>
          <div className="text-xl font-bold text-emerald-700">
            {fmtAdminAmount(totals.averageProfitPerHourCents)} / uur
          </div>
          <p className="text-[11px] text-zinc-500">
            Totale netto winst: {fmtAdminAmount(totals.totalOperatingProfitCents)} ({totals.overallProfitMarginPct}%)
          </p>
        </div>
      </div>

      {/* ── 3. Dynamische Potjes & Spaardoelen (Beweegt mee met de omzet) ── */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-zinc-900">Dynamische Potjes & Spaardoelen</h3>
            <span className="text-xs text-zinc-400">— bewegen automatisch mee met je maandomzet</span>
          </div>
          <span className="text-xs font-semibold text-zinc-700">
            Totaal gereserveerd: {fmtAdminAmount(cash.totalPotsReservedCents)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Onderhoudspotje */}
          <div className="bg-zinc-50 border border-zinc-200/60 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-zinc-700" />
                <span className="text-xs font-semibold text-zinc-800">Boot-onderhoud & Vloot</span>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-200/70 text-zinc-700">
                {settings.maintenancePct}% van omzet
              </span>
            </div>
            <div className="text-lg font-bold text-zinc-900">
              {fmtAdminAmount(totals.totalMaintenanceReservedCents)}
            </div>
            <p className="text-xs text-zinc-500">
              Automatisch opgebouwd uit {selectedYear} omzet voor werfbeurt, accu’s en reparaties.
            </p>
          </div>

          {/* Marketingpotje */}
          <div className="bg-zinc-50 border border-zinc-200/60 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-semibold text-zinc-800">Marketing & Groei (Google Ads)</span>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                {settings.marketingPct}% van omzet
              </span>
            </div>
            <div className="text-lg font-bold text-zinc-900">
              {fmtAdminAmount(totals.totalMarketingBudgetCents)}
            </div>
            <p className="text-xs text-zinc-500">
              Beweegt mee met seizoensomzet. Meer boekingen = automatisch meer advertentieruimte.
            </p>
          </div>

          {/* Winterbuffer Tracker */}
          <div className="bg-zinc-50 border border-zinc-200/60 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-semibold text-zinc-800">Winterbuffer Doel</span>
              </div>
              <span className="text-xs font-semibold text-indigo-700">
                {Math.min(100, Math.round((totals.totalOperatingProfitCents / settings.winterBufferTargetCents) * 100))}%
              </span>
            </div>
            <div className="text-lg font-bold text-zinc-900">
              {fmtAdminAmount(Math.min(totals.totalOperatingProfitCents, settings.winterBufferTargetCents))} / {fmtAdminAmount(settings.winterBufferTargetCents)}
            </div>
            <div className="w-full bg-zinc-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.round((totals.totalOperatingProfitCents / settings.winterBufferTargetCents) * 100))}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500">
              Veiliggesteld kapitaal om nov - mrt vaste lasten zorgeloos te dekken.
            </p>
          </div>
        </div>
      </div>

      {/* ── 4. Maandelijkse Winst- & Kostenmatrix ── */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Maandelijkse Winst- & Rendementsmatrix ({selectedYear})</h3>
            <p className="text-xs text-zinc-500">Omzet minus reële variabele kosten per maand</p>
          </div>
          <div className="text-xs text-zinc-500 font-medium">
            Jaaromzet: <strong className="text-zinc-900">{fmtAdminAmount(totals.totalRevenueCents)}</strong> · 
            Netto Winst: <strong className="text-emerald-700">{fmtAdminAmount(totals.totalOperatingProfitCents)} ({totals.overallProfitMarginPct}%)</strong>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-100/70 border-b border-zinc-200 text-zinc-600 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="px-4 py-3">Maand</th>
                <th className="px-4 py-3 text-right">Omzet</th>
                <th className="px-4 py-3 text-right">Schipper</th>
                <th className="px-4 py-3 text-right">Catering Inkoop</th>
                <th className="px-4 py-3 text-right">Commissie &amp; Tax</th>
                <th className="px-4 py-3 text-right">Netto Winst</th>
                <th className="px-4 py-3 text-right">Marge %</th>
                <th className="px-4 py-3 text-right">Onderhoud ({settings.maintenancePct}%)</th>
                <th className="px-4 py-3 text-right">Marketing ({settings.marketingPct}%)</th>
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {months.map(m => {
                const isExpanded = expandedMonth === m.month
                const hasActivity = m.bookingCount > 0 || m.totalRevenueCents > 0

                return (
                  <tr
                    key={m.month}
                    className={`transition-colors cursor-pointer hover:bg-zinc-50/80 ${
                      m.isCurrentMonth ? 'bg-blue-50/30 font-medium' : ''
                    }`}
                    onClick={() => setExpandedMonth(isExpanded ? null : m.month)}
                  >
                    <td className="px-4 py-3 font-semibold text-zinc-900 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {m.monthLabel}
                        {m.isCurrentMonth && (
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-blue-100 text-blue-800">
                            Actueel
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400 font-normal">
                        {m.bookingCount} vaarten · {m.skipperHours}u gevaren
                      </span>
                    </td>

                    {/* Omzet */}
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                      {fmtAdminAmount(m.totalRevenueCents)}
                    </td>

                    {/* Schipper */}
                    <td className="px-4 py-3 text-right text-zinc-700">
                      {m.skipperCostCents > 0 ? (
                        <div>
                          <span>− {fmtAdminAmount(m.skipperCostCents)}</span>
                          <span className="block text-[10px] text-zinc-400">{m.skipperRatioPct}% omzet</span>
                        </div>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* Catering Inkoop */}
                    <td className="px-4 py-3 text-right text-zinc-700">
                      {m.cateringCostCents > 0 ? (
                        <div>
                          <span>− {fmtAdminAmount(m.cateringCostCents)}</span>
                          <span className="block text-[10px] text-emerald-600 font-medium">+{m.cateringMarginPct}% marge</span>
                        </div>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* Commissies & Tax */}
                    <td className="px-4 py-3 text-right text-zinc-500">
                      {m.channelCommissionCents + m.cityTaxCents > 0 ? (
                        <span>− {fmtAdminAmount(m.channelCommissionCents + m.cityTaxCents)}</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* Netto Winst */}
                    <td className="px-4 py-3 text-right font-bold text-emerald-700 text-sm">
                      {fmtAdminAmount(m.operatingProfitCents)}
                    </td>

                    {/* Marge % */}
                    <td className="px-4 py-3 text-right">
                      {hasActivity ? (
                        <span className={`px-2 py-0.5 rounded font-semibold text-xs ${
                          m.operatingProfitPct >= 60 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {m.operatingProfitPct}%
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* Onderhoud Pot */}
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {m.maintenancePotCents > 0 ? fmtAdminAmount(m.maintenancePotCents) : '—'}
                    </td>

                    {/* Marketing Pot */}
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {m.marketingPotCents > 0 ? fmtAdminAmount(m.marketingPotCents) : '—'}
                    </td>

                    <td className="px-3 py-3 text-right text-zinc-400">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-zinc-100/90 font-bold border-t border-zinc-300 text-zinc-900">
              <tr>
                <td className="px-4 py-3">TOTAAL {selectedYear}</td>
                <td className="px-4 py-3 text-right">{fmtAdminAmount(totals.totalRevenueCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-700">− {fmtAdminAmount(totals.totalSkipperCostCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-700">− {fmtAdminAmount(totals.totalCateringCostCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-500">—</td>
                <td className="px-4 py-3 text-right text-emerald-700 text-sm">{fmtAdminAmount(totals.totalOperatingProfitCents)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{totals.overallProfitMarginPct}%</td>
                <td className="px-4 py-3 text-right">{fmtAdminAmount(totals.totalMaintenanceReservedCents)}</td>
                <td className="px-4 py-3 text-right">{fmtAdminAmount(totals.totalMarketingBudgetCents)}</td>
                <td className="px-3 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Settings Modal ── */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-zinc-800" />
                <h3 className="font-bold text-zinc-900">Potjes &amp; Budget Instellingen</h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-400 hover:text-zinc-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Onderhoud (% omzet)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.maintenancePct}
                    onChange={e => setSettingsForm({ ...settingsForm, maintenancePct: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">Standaard: 8%</p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Marketing &amp; Ads (% omzet)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.marketingPct}
                    onChange={e => setSettingsForm({ ...settingsForm, marketingPct: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">Standaard: 6%</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Streefomzet Maand (€)</label>
                  <input
                    type="number"
                    step="1000"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.monthlyRevenueTargetEuros}
                    onChange={e => setSettingsForm({ ...settingsForm, monthlyRevenueTargetEuros: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">bv. € 40.000 in hoogseizoen</p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Winterbuffer Doel (€)</label>
                  <input
                    type="number"
                    step="1000"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.winterBufferTargetEuros}
                    onChange={e => setSettingsForm({ ...settingsForm, winterBufferTargetEuros: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">bv. € 25.000 voor nov - mrt</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Standaard Schipperstarief (€/u)</label>
                  <input
                    type="number"
                    step="1"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.defaultSkipperHourlyRateEuros}
                    onChange={e => setSettingsForm({ ...settingsForm, defaultSkipperHourlyRateEuros: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">Voor onbelegde/geschatte vaarten</p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Max Schippersratio (%)</label>
                  <input
                    type="number"
                    step="1"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.targetSkipperRatioPct}
                    onChange={e => setSettingsForm({ ...settingsForm, targetSkipperRatioPct: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">Standaard max: 18% van omzet</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-4 py-2 border border-zinc-200 rounded-lg font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-4 py-2 bg-zinc-900 hover:bg-black text-white rounded-lg font-semibold shadow-sm"
                >
                  {savingSettings ? 'Opslaan...' : 'Instellingen Opslaan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
