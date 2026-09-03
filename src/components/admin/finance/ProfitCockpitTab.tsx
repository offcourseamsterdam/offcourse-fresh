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
  CreditCard,
  Crown,
  PiggyBank,
  Banknote,
  CalendarCheck
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
    profitFirstProfitPct: 5,
    ownerSalaryMonthlyEuros: 3500,
    boatCount: 2,
    berthFeePerBoatYearlyEuros: 4000,
    otherFixedCostsMonthlyEuros: 1200,
    zettleCogsPct: 28,
    loanName: 'Bootfinanciering',
    loanPrincipalTotalEuros: 40000,
    loanMonthlyPrincipalEuros: 750,
    loanMonthlyInterestEuros: 175,
    loanInterestRatePct: 5.5,
    loanTargetPayoffYear: 2028,
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
        profitFirstProfitPct: data.settings.profitFirstProfitPct ?? 5,
        ownerSalaryMonthlyEuros: Math.round((data.settings.ownerSalaryMonthlyCents ?? 350000) / 100),
        boatCount: data.settings.boatCount ?? 2,
        berthFeePerBoatYearlyEuros: Math.round((data.settings.berthFeePerBoatYearlyCents ?? 400000) / 100),
        otherFixedCostsMonthlyEuros: Math.round((data.settings.otherFixedCostsMonthlyCents ?? 120000) / 100),
        zettleCogsPct: data.settings.zettleCogsPct ?? 28,
        loanName: data.settings.loanName ?? 'Bootfinanciering',
        loanPrincipalTotalEuros: Math.round((data.settings.loanPrincipalTotalCents ?? 4000000) / 100),
        loanMonthlyPrincipalEuros: Math.round((data.settings.loanMonthlyPrincipalCents ?? 75000) / 100),
        loanMonthlyInterestEuros: Math.round((data.settings.loanMonthlyInterestCents ?? 17500) / 100),
        loanInterestRatePct: data.settings.loanInterestRatePct ?? 5.5,
        loanTargetPayoffYear: data.settings.loanTargetPayoffYear ?? 2028,
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
          profitFirstProfitPct: Number(settingsForm.profitFirstProfitPct),
          ownerSalaryMonthlyCents: Number(settingsForm.ownerSalaryMonthlyEuros) * 100,
          boatCount: Number(settingsForm.boatCount),
          berthFeePerBoatYearlyCents: Number(settingsForm.berthFeePerBoatYearlyEuros) * 100,
          otherFixedCostsMonthlyCents: Number(settingsForm.otherFixedCostsMonthlyEuros) * 100,
          zettleCogsPct: Number(settingsForm.zettleCogsPct),
          loanName: settingsForm.loanName,
          loanPrincipalTotalCents: Number(settingsForm.loanPrincipalTotalEuros) * 100,
          loanMonthlyPrincipalCents: Number(settingsForm.loanMonthlyPrincipalEuros) * 100,
          loanMonthlyInterestCents: Number(settingsForm.loanMonthlyInterestEuros) * 100,
          loanInterestRatePct: Number(settingsForm.loanInterestRatePct),
          loanTargetPayoffYear: Number(settingsForm.loanTargetPayoffYear),
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
        Winst-, vaste lasten, lening- en Profit First data berekenen...
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
            <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Winst &amp; Cash Cockpit</h2>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300/60">
              Profit First &amp; Lening Plan
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Sturing op omzet, Zettle pin aan boord, schippers, catering, liggeld (€ 4k/boot), rente &amp; aflossing en eigenaarsloon.
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
            Vaste Lasten, Lening &amp; Potjes
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
            {cash.revolut.primaryAccountName || 'Direct op bankrekening'}
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
            <span className="text-xs font-medium text-zinc-400">Lopend Operationeel</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-amber-300">
            − {fmtAdminAmount(cash.currentMonthLiabilitiesCents)}
          </div>
          <p className="text-[11px] text-zinc-400">
            Schippersuren &amp; catering deze maand
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
            Na aftrek van potjes, lening &amp; lasten
          </p>
        </div>
      </div>

      {/* ── 2. PROFIT FIRST ALLOCATIES, VASTE LASTEN & LENING BANNER ── */}
      <div className="bg-amber-50/50 border border-amber-200/80 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/60 pb-2.5">
          <div className="flex items-center gap-2">
            <PiggyBank className="w-5 h-5 text-amber-700" />
            <h3 className="text-sm font-bold text-amber-950">Profit First Systeem &amp; Financiering</h3>
            <span className="text-xs text-amber-700 font-normal">
              — Winst &amp; salaris als eerste afromen, schuldverplichting veiligstellen
            </span>
          </div>
          <span className="text-xs font-semibold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full">
            Status: Gezonde Marge ✓
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Echte Winstpot (Profit First) */}
          <div className="bg-white rounded-xl border border-amber-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Winstpot ({settings.profitFirstProfitPct}%)
              </span>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">
                Profit First
              </span>
            </div>
            <div className="text-lg font-bold text-amber-900">
              {fmtAdminAmount(totals.totalProfitFirstProfitCents)}
            </div>
            <p className="text-[10px] text-zinc-500">
              Directe winstreservering (kwartaalbonus).
            </p>
          </div>

          {/* Eigenaarssalaris (Beer) */}
          <div className="bg-white rounded-xl border border-amber-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                <Crown className="w-3.5 h-3.5 text-amber-600" />
                Eigenaarsloon
              </span>
              <span className="text-[10px] text-zinc-500">
                {fmtAdminAmount(settings.ownerSalaryMonthlyCents)}/mnd
              </span>
            </div>
            <div className="text-lg font-bold text-amber-900">
              {fmtAdminAmount(totals.totalOwnerSalaryCents)}
            </div>
            <p className="text-[10px] text-zinc-500">
              Gereserveerd maandsalaris voor Beer.
            </p>
          </div>

          {/* Liggeld Boten */}
          <div className="bg-white rounded-xl border border-amber-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                <Anchor className="w-3.5 h-3.5 text-amber-600" />
                Liggeld ({settings.boatCount} boten)
              </span>
              <span className="text-[10px] text-zinc-500">
                € 4.000 ex / boot
              </span>
            </div>
            <div className="text-lg font-bold text-zinc-900">
              {fmtAdminAmount(totals.totalBerthFeeCents)}
            </div>
            <p className="text-[10px] text-zinc-500">
              Vast liggeld: {fmtAdminAmount(Math.round((settings.boatCount * settings.berthFeePerBoatYearlyCents) / 12))}/mnd.
            </p>
          </div>

          {/* Lening & Aflosplan */}
          <div className="bg-white rounded-xl border border-rose-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-950 flex items-center gap-1">
                <Banknote className="w-3.5 h-3.5 text-rose-600" />
                {settings.loanName}
              </span>
              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded">
                {settings.loanInterestRatePct}% rente
              </span>
            </div>
            <div className="text-lg font-bold text-rose-900">
              − {fmtAdminAmount(totals.totalDebtServiceCents)}
            </div>
            <p className="text-[10px] text-zinc-500">
              Last: {fmtAdminAmount(settings.loanMonthlyPrincipalCents + settings.loanMonthlyInterestCents)}/mnd (aflos {fmtAdminAmount(settings.loanMonthlyPrincipalCents)} · rente {fmtAdminAmount(settings.loanMonthlyInterestCents)})
            </p>
          </div>

          {/* Zettle Boordverkoop Omzet */}
          <div className="bg-white rounded-xl border border-amber-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                Zettle Boordomzet
              </span>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded font-semibold">
                +{100 - settings.zettleCogsPct}% marge
              </span>
            </div>
            <div className="text-lg font-bold text-zinc-900">
              {fmtAdminAmount(totals.totalZettleSellingCents)}
            </div>
            <p className="text-[10px] text-zinc-500">
              Drankjes &amp; snacks aan boord afgerekend.
            </p>
          </div>
        </div>
      </div>

      {/* ── 3. LENING & SCHULDENVRIJ SPARRPLAN VOORTGANG ── */}
      <div className="bg-gradient-to-r from-rose-50 via-white to-amber-50 border border-rose-200/80 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-rose-600" />
            <h4 className="text-xs font-bold text-rose-950 uppercase tracking-wider">
              Aflosplan &amp; Schuldvrij Tracker ({settings.loanName})
            </h4>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-zinc-600">
              Resterende Hoofdsom: <strong className="text-rose-900 font-bold">{fmtAdminAmount(totals.remainingLoanPrincipalCents)}</strong>
            </span>
            <span className="text-rose-700 bg-rose-100/70 px-2 py-0.5 rounded-full font-semibold text-[11px]">
              Schuldenvrij in ~{totals.monthsUntilDebtFree} maanden ({settings.loanTargetPayoffYear})
            </span>
          </div>
        </div>

        <div className="w-full bg-rose-100/60 h-2.5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-emerald-500 rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.round(((settings.loanPrincipalTotalCents - totals.remainingLoanPrincipalCents) / settings.loanPrincipalTotalCents) * 100))}%`
            }}
          />
        </div>

        <div className="flex justify-between text-[11px] text-zinc-500">
          <span>Oorspronkelijk: {fmtAdminAmount(settings.loanPrincipalTotalCents)}</span>
          <span>Aflossing: {fmtAdminAmount(settings.loanMonthlyPrincipalCents)}/mnd · Rente: {fmtAdminAmount(settings.loanMonthlyInterestCents)}/mnd ({settings.loanInterestRatePct}%)</span>
          <span>Doel: Volledig afgelost in {settings.loanTargetPayoffYear}</span>
        </div>
      </div>

      {/* ── 4. KPI Cards & Doelen ── */}
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
            {totals.totalHoursCruised} vaar-uren in {selectedYear}
          </p>
        </div>

        {/* Catering & Bar Brutomarge */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
            <span>Catering &amp; Bar Marge</span>
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
            Verkoop {fmtAdminAmount(totals.totalCateringSellingCents)} (incl. Zettle)
          </p>
        </div>

        {/* Winst per Vaar-Uur */}
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
            <span>Netto Winst per Vaar-uur</span>
            <span className="text-xs text-zinc-400 font-normal">Na schipper &amp; inkoop</span>
          </div>
          <div className="text-xl font-bold text-emerald-700">
            {fmtAdminAmount(totals.averageProfitPerHourCents)} / uur
          </div>
          <p className="text-[11px] text-zinc-500">
            Totale operationele marge: {fmtAdminAmount(totals.totalOperatingProfitCents)} ({totals.overallProfitMarginPct}%)
          </p>
        </div>
      </div>

      {/* ── 5. Dynamische Potjes & Spaardoelen ── */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-zinc-900">Dynamische Potjes (Beweegt mee met de omzet)</h3>
          </div>
          <span className="text-xs font-semibold text-zinc-700">
            Gereserveerd Vloot &amp; Groei: {fmtAdminAmount(totals.totalMaintenanceReservedCents + totals.totalMarketingBudgetCents)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Onderhoudspotje */}
          <div className="bg-zinc-50 border border-zinc-200/60 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-zinc-700" />
                <span className="text-xs font-semibold text-zinc-800">Boot-onderhoud &amp; Vloot</span>
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
                <span className="text-xs font-semibold text-zinc-800">Marketing &amp; Groei (Google Ads)</span>
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

      {/* ── 6. Maandelijkse Winst- & Rendementsmatrix ── */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Maandelijkse Winst- &amp; Rendementsmatrix ({selectedYear})</h3>
            <p className="text-xs text-zinc-500">Inclusief Zettle omzet, liggeld, rente &amp; aflossing en Profit First toewijzingen</p>
          </div>
          <div className="text-xs text-zinc-500 font-medium">
            Jaaromzet: <strong className="text-zinc-900">{fmtAdminAmount(totals.totalRevenueCents)}</strong> · 
            Operationeel: <strong className="text-emerald-700">{fmtAdminAmount(totals.totalOperatingProfitCents)} ({totals.overallProfitMarginPct}%)</strong>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-100/70 border-b border-zinc-200 text-zinc-600 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="px-4 py-3">Maand</th>
                <th className="px-4 py-3 text-right">Totale Omzet</th>
                <th className="px-4 py-3 text-right">Waarvan Zettle</th>
                <th className="px-4 py-3 text-right">Schipper</th>
                <th className="px-4 py-3 text-right">Catering Inkoop</th>
                <th className="px-4 py-3 text-right">Vaste Lasten</th>
                <th className="px-4 py-3 text-right">Lening (Aflos+Rente)</th>
                <th className="px-4 py-3 text-right">Winstpot ({settings.profitFirstProfitPct}%)</th>
                <th className="px-4 py-3 text-right">Eigenaarsloon</th>
                <th className="px-4 py-3 text-right">Netto Vrij</th>
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
                        {m.bookingCount} vaarten · {m.skipperHours}u
                      </span>
                    </td>

                    {/* Omzet */}
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                      {fmtAdminAmount(m.totalRevenueCents)}
                    </td>

                    {/* Zettle */}
                    <td className="px-4 py-3 text-right text-zinc-600">
                      {m.zettleSellingCents > 0 ? (
                        <span className="font-medium text-emerald-700">+{fmtAdminAmount(m.zettleSellingCents)}</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* Schipper */}
                    <td className="px-4 py-3 text-right text-zinc-700">
                      {m.skipperCostCents > 0 ? (
                        <div>
                          <span>− {fmtAdminAmount(m.skipperCostCents)}</span>
                          <span className="block text-[10px] text-zinc-400">{m.skipperRatioPct}%</span>
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

                    {/* Vaste Lasten (Liggeld + Overig) */}
                    <td className="px-4 py-3 text-right text-zinc-500">
                      <div>
                        <span>− {fmtAdminAmount(m.totalFixedCostsCents)}</span>
                        <span className="block text-[10px] text-zinc-400">liggeld {fmtAdminAmount(m.berthFeeMonthlyCents)}</span>
                      </div>
                    </td>

                    {/* Lening & Aflossing */}
                    <td className="px-4 py-3 text-right text-rose-800">
                      <div>
                        <span className="font-semibold">− {fmtAdminAmount(m.totalDebtServiceCents)}</span>
                        <span className="block text-[10px] text-rose-600">aflos {fmtAdminAmount(m.loanPrincipalCents)} · rente {fmtAdminAmount(m.loanInterestCents)}</span>
                      </div>
                    </td>

                    {/* Profit First Winstpot */}
                    <td className="px-4 py-3 text-right font-semibold text-amber-800">
                      {m.profitFirstProfitPotCents > 0 ? fmtAdminAmount(m.profitFirstProfitPotCents) : '—'}
                    </td>

                    {/* Eigenaarsloon */}
                    <td className="px-4 py-3 text-right font-semibold text-zinc-800">
                      {fmtAdminAmount(m.ownerSalaryPotCents)}
                    </td>

                    {/* Netto Vrij na alle potten */}
                    <td className="px-4 py-3 text-right font-bold text-sm">
                      <span className={m.netFreeCashAfterPotsCents >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                        {fmtAdminAmount(m.netFreeCashAfterPotsCents)}
                      </span>
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
                <td className="px-4 py-3 text-right text-emerald-700">+{fmtAdminAmount(totals.totalZettleSellingCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-700">− {fmtAdminAmount(totals.totalSkipperCostCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-700">− {fmtAdminAmount(totals.totalCateringCostCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-600">− {fmtAdminAmount(totals.totalFixedCostsCents)}</td>
                <td className="px-4 py-3 text-right text-rose-800 font-bold">− {fmtAdminAmount(totals.totalDebtServiceCents)}</td>
                <td className="px-4 py-3 text-right text-amber-800">{fmtAdminAmount(totals.totalProfitFirstProfitCents)}</td>
                <td className="px-4 py-3 text-right text-zinc-800">{fmtAdminAmount(totals.totalOwnerSalaryCents)}</td>
                <td className="px-4 py-3 text-right text-emerald-700 font-black text-sm">
                  {fmtAdminAmount(totals.totalOperatingProfitCents - totals.totalFixedCostsCents - totals.totalDebtServiceCents - totals.totalProfitFirstProfitCents - totals.totalOwnerSalaryCents - totals.totalMaintenanceReservedCents - totals.totalMarketingBudgetCents)}
                </td>
                <td className="px-3 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Settings Modal ── */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-amber-700" />
                <h3 className="font-bold text-zinc-900">Vaste Lasten, Lening &amp; Profit First</h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-400 hover:text-zinc-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-5 text-xs">
              {/* Lening & Financiering Blok */}
              <div className="bg-rose-50/60 border border-rose-200/80 p-3.5 rounded-xl space-y-3">
                <h4 className="font-bold text-rose-950 flex items-center gap-1.5">
                  <Banknote className="w-4 h-4 text-rose-700" />
                  Lening &amp; Financiering (Rente &amp; Aflossing)
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1 sm:col-span-3">
                    <label className="font-semibold text-zinc-700">Omschrijving Lening</label>
                    <input
                      type="text"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.loanName}
                      onChange={e => setSettingsForm({ ...settingsForm, loanName: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Openstaande Schuld (€)</label>
                    <input
                      type="number"
                      step="1000"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.loanPrincipalTotalEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, loanPrincipalTotalEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">bv. € 40.000</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Aflossing (€ / mnd)</label>
                    <input
                      type="number"
                      step="50"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.loanMonthlyPrincipalEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, loanMonthlyPrincipalEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">bv. € 750 / mnd</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Rente (€ / mnd)</label>
                    <input
                      type="number"
                      step="25"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.loanMonthlyInterestEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, loanMonthlyInterestEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">bv. € 175 / mnd</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Rentepercentage (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.loanInterestRatePct}
                      onChange={e => setSettingsForm({ ...settingsForm, loanInterestRatePct: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">bv. 5.5%</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Doel Schuldenvrij (Jaar)</label>
                    <input
                      type="number"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.loanTargetPayoffYear}
                      onChange={e => setSettingsForm({ ...settingsForm, loanTargetPayoffYear: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">bv. 2028</p>
                  </div>
                </div>
              </div>

              {/* Profit First Blok */}
              <div className="bg-amber-50/60 border border-amber-200/80 p-3.5 rounded-xl space-y-3">
                <h4 className="font-bold text-amber-950 flex items-center gap-1.5">
                  <PiggyBank className="w-4 h-4 text-amber-700" />
                  Profit First Allocaties
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Winstpot (% van omzet)</label>
                    <input
                      type="number"
                      step="0.5"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.profitFirstProfitPct}
                      onChange={e => setSettingsForm({ ...settingsForm, profitFirstProfitPct: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-500">Standaard: 5% direct naar winstrekening</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Eigenaarsloon (€ / maand)</label>
                    <input
                      type="number"
                      step="250"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.ownerSalaryMonthlyEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, ownerSalaryMonthlyEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-500">Salaris voor Beer (bv. € 3.500 / mnd)</p>
                  </div>
                </div>
              </div>

              {/* Vaste Lasten & Liggeld Blok */}
              <div className="bg-zinc-50 border border-zinc-200/80 p-3.5 rounded-xl space-y-3">
                <h4 className="font-bold text-zinc-900 flex items-center gap-1.5">
                  <Anchor className="w-4 h-4 text-zinc-700" />
                  Vaste Lasten &amp; Liggeld
                </h4>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Aantal Boten</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.boatCount}
                      onChange={e => setSettingsForm({ ...settingsForm, boatCount: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">Actieve vloot (bv. 2)</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Liggeld (€/boot/jaar)</label>
                    <input
                      type="number"
                      step="500"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.berthFeePerBoatYearlyEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, berthFeePerBoatYearlyEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">Ex BTW (bv. € 4.000)</p>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700">Overig vast (€/mnd)</label>
                    <input
                      type="number"
                      step="100"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.otherFixedCostsMonthlyEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, otherFixedCostsMonthlyEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">Verzekering, software, adm</p>
                  </div>
                </div>
              </div>

              {/* Potjes & Targets Blok */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Onderhoudspot (% omzet)</label>
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
                  <label className="font-semibold text-zinc-700">Marketingpot (% omzet)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.marketingPct}
                    onChange={e => setSettingsForm({ ...settingsForm, marketingPct: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">Standaard: 6%</p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700">Zettle Boord-inkoop (%)</label>
                  <input
                    type="number"
                    step="1"
                    className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900"
                    value={settingsForm.zettleCogsPct}
                    onChange={e => setSettingsForm({ ...settingsForm, zettleCogsPct: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-zinc-400">Standaard: 28% inkoop drank</p>
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
                  <p className="text-[10px] text-zinc-400">bv. € 25.000 doel</p>
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
