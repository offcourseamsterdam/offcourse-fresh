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
  CalendarCheck,
  Zap,
  Lightbulb,
  Plus,
  Trash2,
  Layers,
  HelpCircle,
  FileText,
  Globe,
} from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminAmount, fmtAdminAmountRounded } from '@/lib/admin/format'
import type {
  MonthlyCockpitRow,
  CockpitTotals,
  CockpitBudgetSettings,
  LoanItem,
  AlfCategorySetting,
  FixedCostItem,
} from '@/lib/finance/profit-cockpit-calculator'
import { DEFAULT_LOANS, DEFAULT_ALF_CATEGORIES, DEFAULT_FIXED_COST_ITEMS } from '@/lib/finance/profit-cockpit-calculator'

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
    stripe?: {
      configured: boolean
      availableEurCents: number
      pendingEurCents: number
      totalEurCents: number
    }
    effectiveBankCashCents: number
    openInvoicesCents: number
    openDirectBookingsCents?: number
    totalReceivablesCents?: number
    currentMonthLiabilitiesCents: number
    totalPotsReservedCents: number
    freeAvailableCashCents: number
  }
  stripeInsights?: {
    nextPayout: {
      arrivalDate: string
      amountCents: number
      daysUntil: number
    } | null
    recentPayouts: Array<{
      id: string
      amountCents: number
      arrivalDate: string
      status: string
    }>
    monthlyFees: {
      totalFeesCents: number
      totalGrossCents: number
      avgFeePct: number
      chargeCount: number
    }
    refunds: {
      monthlyRefundsCents: number
      refundCount: number
    }
    disputes: {
      activeCount: number
      totalCount: number
    }
    invoiceAging: Array<{
      id: string
      number: string | null
      customerName: string | null
      amountCents: number
      dueDate: string | null
      agingStatus: 'on_track' | 'due_soon' | 'overdue'
    }>
  }
  platformPayouts?: {
    totalGrossCents: number
    totalCommissionCents: number
    totalNetCents: number
    count: number
    byPlatform: Record<string, number>
  }
}

export function ProfitCockpitTab() {
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showWhatIfDrawer, setShowWhatIfDrawer] = useState(false)
  const [showPayoutHistory, setShowPayoutHistory] = useState(false)

  const { data, isLoading, error, refresh } = useAdminFetch<ProfitCockpitResponse>(
    `/api/admin/finance/profit-cockpit?year=${selectedYear}`
  )

  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState<{
    maintenancePct: number
    marketingPct: number
    profitFirstProfitPct: number
    ownerSalaryMonthlyEuros: number
    boatCount: number
    berthFeePerBoatYearlyEuros: number
    otherFixedCostsMonthlyEuros: number
    fixedCostItems: FixedCostItem[]
    zettleCogsPct: number
    loans: LoanItem[]
    marketingScenarioSpendEuros: number
    alfCategories: AlfCategorySetting[]
    winterBufferTargetEuros: number
    monthlyRevenueTargetEuros: number
    targetSkipperRatioPct: number
    defaultSkipperHourlyRateEuros: number
  }>({
    maintenancePct: 8,
    marketingPct: 6,
    profitFirstProfitPct: 5,
    ownerSalaryMonthlyEuros: 3500,
    boatCount: 2,
    berthFeePerBoatYearlyEuros: 4000,
    otherFixedCostsMonthlyEuros: 1200,
    fixedCostItems: DEFAULT_FIXED_COST_ITEMS,
    zettleCogsPct: 28,
    loans: DEFAULT_LOANS,
    marketingScenarioSpendEuros: 2000,
    alfCategories: DEFAULT_ALF_CATEGORIES,
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
        fixedCostItems: data.settings.fixedCostItems && data.settings.fixedCostItems.length > 0
          ? data.settings.fixedCostItems
          : DEFAULT_FIXED_COST_ITEMS,
        zettleCogsPct: data.settings.zettleCogsPct ?? 28,
        loans: data.settings.loans && data.settings.loans.length > 0 ? data.settings.loans : DEFAULT_LOANS,
        marketingScenarioSpendEuros: Math.round((data.settings.marketingScenarioSpendCents ?? 200000) / 100),
        alfCategories: data.settings.alfCategories && data.settings.alfCategories.length > 0 ? data.settings.alfCategories : DEFAULT_ALF_CATEGORIES,
        winterBufferTargetEuros: Math.round(data.settings.winterBufferTargetCents / 100),
        monthlyRevenueTargetEuros: Math.round(data.settings.defaultMonthlyRevenueTargetCents / 100),
        targetSkipperRatioPct: data.settings.targetSkipperRatioPct,
        defaultSkipperHourlyRateEuros: Math.round(data.settings.defaultSkipperHourlyRateCents / 100),
      })
    }
    setShowSettingsModal(true)
  }

  function handleAddFixedCostItem() {
    setSettingsForm(prev => ({
      ...prev,
      fixedCostItems: [
        ...prev.fixedCostItems,
        {
          id: `fc-${Date.now()}`,
          name: 'Nieuw abonnement (bv. Telefoon)',
          monthlyCents: 4500,
        },
      ],
    }))
  }

  function handleUpdateFixedCostItem(id: string, patch: Partial<FixedCostItem>) {
    setSettingsForm(prev => ({
      ...prev,
      fixedCostItems: prev.fixedCostItems.map(item => item.id === id ? { ...item, ...patch } : item),
    }))
  }

  function handleRemoveFixedCostItem(id: string) {
    setSettingsForm(prev => ({
      ...prev,
      fixedCostItems: prev.fixedCostItems.filter(item => item.id !== id),
    }))
  }

  async function handleQuickScenarioUpdate(patch: Partial<CockpitBudgetSettings>) {
    try {
      await fetch('/api/admin/finance/profit-cockpit/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await refresh()
    } catch (err) {
      console.error('Failed to update scenario:', err)
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    try {
      const computedOtherFixedMonthlyCents = settingsForm.fixedCostItems.reduce((s, i) => s + i.monthlyCents, 0)
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
          otherFixedCostsMonthlyCents: computedOtherFixedMonthlyCents,
          fixedCostItems: settingsForm.fixedCostItems,
          zettleCogsPct: Number(settingsForm.zettleCogsPct),
          loans: settingsForm.loans,
          marketingScenarioSpendCents: Number(settingsForm.marketingScenarioSpendEuros) * 100,
          alfCategories: settingsForm.alfCategories,
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-gradient-to-br from-zinc-900 via-zinc-850 to-zinc-900 text-white rounded-2xl p-5 shadow-xl">
        {/* Revolut Saldo */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-medium text-zinc-400">Revolut Saldo</span>
            {cash.revolut.configured ? (
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">Live</span>
            ) : (
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-zinc-700 text-zinc-300">Handmatig</span>
            )}
          </div>
          <div className="text-xl font-bold tracking-tight text-white">
            {fmtAdminAmount(cash.effectiveBankCashCents)}
          </div>
          <p className="text-[11px] text-zinc-400">
            {cash.revolut.primaryAccountName || 'Op bankrekening'}
          </p>
        </div>

        {/* Stripe Balans (Directe Boekingen) */}
        <div className="space-y-1 sm:border-l sm:border-zinc-800 sm:pl-3 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CreditCard className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-medium text-zinc-400">Stripe Balans</span>
            </div>
            {data?.stripeInsights?.disputes?.activeCount === 0 ? (
              <span className="text-[10px] font-semibold text-emerald-400" title="0 actieve geschillen">
                ✓ 0 claims
              </span>
            ) : (
              <span className="text-[10px] font-bold text-rose-400 bg-rose-500/20 px-1 py-0.2 rounded">
                ⚠️ Betwisting!
              </span>
            )}
          </div>
          <div className="text-xl font-bold tracking-tight text-purple-300">
            {fmtAdminAmount(cash.stripe?.totalEurCents ?? 0)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              {data?.stripeInsights?.nextPayout
                ? `1 okt naar bank (${data.stripeInsights.nextPayout.daysUntil}d)`
                : 'Directe boekingen in transit'}
            </span>
            {data?.stripeInsights?.recentPayouts && data.stripeInsights.recentPayouts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPayoutHistory(!showPayoutHistory)}
                className="text-purple-300 hover:text-purple-200 text-[10px] underline ml-1 cursor-pointer"
              >
                {showPayoutHistory ? 'sluit' : 'historie ▾'}
              </button>
            )}
          </div>

          {/* Popover Recent Payouts */}
          {showPayoutHistory && data?.stripeInsights?.recentPayouts && (
            <div className="absolute top-full left-0 mt-2 z-30 w-56 bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-zinc-200 pb-1 border-b border-zinc-800 text-[11px]">
                <span>Vorige Uitbetalingen</span>
                <span className="text-emerald-400">Revolut</span>
              </div>
              <div className="space-y-1.5">
                {data.stripeInsights.recentPayouts.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">
                      {new Date(p.arrivalDate).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="font-medium text-white">
                      {fmtAdminAmount(p.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Openstaande Facturen & Betaallinks */}
        <div className="space-y-1 lg:border-l lg:border-zinc-800 lg:pl-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-medium text-zinc-400">Openstaand Facturen</span>
          </div>
          <div className="text-xl font-bold tracking-tight text-sky-300">
            + {fmtAdminAmount((cash.openInvoicesCents || 0) + (cash.openDirectBookingsCents || 0))}
          </div>
          <div className="text-[11px]">
            {data?.stripeInsights?.invoiceAging && data.stripeInsights.invoiceAging.length > 0 ? (
              (() => {
                const overdue = data.stripeInsights.invoiceAging.filter(i => i.agingStatus === 'overdue')
                const dueSoon = data.stripeInsights.invoiceAging.filter(i => i.agingStatus === 'due_soon')
                if (overdue.length > 0) {
                  return (
                    <span className="text-rose-400 font-medium">
                      🔴 {overdue.length} factuur verlopen ({overdue[0].customerName?.slice(0, 14)})
                    </span>
                  )
                }
                if (dueSoon.length > 0) {
                  return (
                    <span className="text-amber-400 font-medium">
                      🟡 {dueSoon.length} vervalt binnenkort
                    </span>
                  )
                }
                return (
                  <span className="text-zinc-400">
                    🟢 {data.stripeInsights.invoiceAging.length} op schema ({data.stripeInsights.invoiceAging[0].customerName?.slice(0, 15)})
                  </span>
                )
              })()
            ) : (
              <span className="text-zinc-400">B2B &amp; betaallinks te ontvangen</span>
            )}
          </div>
        </div>

        {/* Lopend Operationeel */}
        <div className="space-y-1 sm:border-l sm:border-zinc-800 sm:pl-3">
          <div className="flex items-center gap-2">
            <Anchor className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-zinc-400">Lopend Operationeel</span>
          </div>
          <div className="text-xl font-bold tracking-tight text-amber-300">
            − {fmtAdminAmount(cash.currentMonthLiabilitiesCents)}
          </div>
          <p className="text-[11px] text-zinc-400">
            Schippers &amp; catering deze maand
          </p>
        </div>

        {/* Vrij Beschikbare Cash */}
        <div className="space-y-1 bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3 sm:border-l-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider">Vrij Beschikbaar</span>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-black tracking-tight text-emerald-400">
            {fmtAdminAmount(cash.freeAvailableCashCents)}
          </div>
          <p className="text-[10px] text-emerald-300/80">
            Bank + Stripe na potjes &amp; lasten
          </p>
        </div>
      </div>

      {/* ── 2. INVESTERINGS-THERMOMETER & STOPLICHT (IN 1 OOGOPSLAG) ── */}
      <div className="bg-white border border-zinc-200/90 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className={`w-4 h-4 rounded-full shrink-0 mt-0.5 sm:mt-0 ${
            totals.investmentGauge.status === 'green' ? 'bg-emerald-500 ring-4 ring-emerald-100' :
            totals.investmentGauge.status === 'orange' ? 'bg-amber-500 ring-4 ring-amber-100' :
            'bg-rose-500 ring-4 ring-rose-100'
          }`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Investerings-Thermometer:</span>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                totals.investmentGauge.status === 'green' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                totals.investmentGauge.status === 'orange' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {totals.investmentGauge.status === 'green' ? '🟢 Veilig om te Investeren' :
                 totals.investmentGauge.status === 'orange' ? '🟡 Beperkte Ruimte' :
                 '🔴 Alleen Noodzakelijke Lasten'}
              </span>
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              {totals.investmentGauge.recommendationText}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end md:self-center shrink-0">
          <div className="text-right">
            <span className="text-[10px] text-zinc-400 block uppercase font-medium">Vrije Investeringsruimte:</span>
            <span className="text-base font-black text-zinc-900">
              {fmtAdminAmount(totals.investmentGauge.freeInvestmentCapacityCents)}/mnd
            </span>
          </div>
          <button
            onClick={() => setShowWhatIfDrawer(!showWhatIfDrawer)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              showWhatIfDrawer
                ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm'
                : 'bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{showWhatIfDrawer ? 'Verberg What-If & Leningen ▲' : '⚡ What-If Simulator & Leningen ▼'}</span>
          </button>
        </div>
      </div>

      {/* ── 3. COMPACTE VASTE LASTEN & LENINGEN STRIP ── */}
      <div className="bg-zinc-50 border border-zinc-200/80 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Anchor className="w-3.5 h-3.5 text-blue-600" />
            <span><strong>Liggeld:</strong> 1/4 opzij in okt, nov, feb, mrt ({fmtAdminAmount(Math.round(totals.totalBerthFeeCents / 4))}/keer)</span>
          </div>
          <div className="hidden sm:inline text-zinc-300">•</div>
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-amber-600" />
            <span><strong>Vaste Abonnementen:</strong> {totals.fixedCostItems.length} posten ({fmtAdminAmount(totals.fixedCostItems.reduce((s, i) => s + i.monthlyCents, 0))}/mnd)</span>
          </div>
          <div className="hidden sm:inline text-zinc-300">•</div>
          <div className="flex items-center gap-1.5">
            <CalendarCheck className="w-3.5 h-3.5 text-rose-600" />
            <span><strong>Leningen:</strong> Restschuld {fmtAdminAmount(totals.remainingLoanPrincipalCents)} ({fmtAdminAmount(Math.round(totals.totalLoanPrincipalCents / 12 + totals.totalLoanInterestCents / 12))}/mnd)</span>
          </div>
          {data?.stripeInsights?.monthlyFees && data.stripeInsights.monthlyFees.totalFeesCents > 0 && (
            <>
              <div className="hidden sm:inline text-zinc-300">•</div>
              <div className="flex items-center gap-1.5" title={`${data.stripeInsights.monthlyFees.chargeCount} betalingen verwerkt deze maand`}>
                <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                <span><strong>Stripe Fees:</strong> {fmtAdminAmount(data.stripeInsights.monthlyFees.totalFeesCents)} ({data.stripeInsights.monthlyFees.avgFeePct}%)</span>
              </div>
            </>
          )}
          {data?.platformPayouts && data.platformPayouts.totalNetCents > 0 && (
            <>
              <div className="hidden sm:inline text-zinc-300">•</div>
              <div
                className="flex items-center gap-1.5"
                title={`Bruto ${fmtAdminAmount(data.platformPayouts.totalGrossCents)} minus ${fmtAdminAmount(data.platformPayouts.totalCommissionCents)} commissie over ${data.platformPayouts.count} ritten. Wordt begin volgende maand overgemaakt.`}
              >
                <Globe className="w-3.5 h-3.5 text-sky-600" />
                <span>
                  <strong>Platform Payouts:</strong> ~{fmtAdminAmount(data.platformPayouts.totalNetCents)}
                  <span className="text-[10px] text-zinc-400 ml-1">
                    (GYG {fmtAdminAmount(data.platformPayouts.byPlatform.getyourguide || 0)} · Viator {fmtAdminAmount(data.platformPayouts.byPlatform.tripadvisor || 0)})
                  </span>
                </span>
              </div>
            </>
          )}
        </div>

        <button
          onClick={openSettings}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 ml-auto"
        >
          Beheer abonnementen &amp; potjes →
        </button>
      </div>

      {/* ── INKLAPBARE WHAT-IF SIMULATOR & LENINGEN DRAWER ── */}
      {showWhatIfDrawer && (
        <div className="space-y-4 p-4 bg-zinc-900 rounded-2xl border border-zinc-800 text-white animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white tracking-tight">What-If Beslissingssimulator &amp; Leningen</h3>
            </div>
            <button
              onClick={() => setShowWhatIfDrawer(false)}
              className="text-zinc-400 hover:text-white text-xs"
            >
              Sluiten ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Module 1: Marketing Scenario */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Megaphone className="w-4 h-4 text-sky-400" />
                    Marketing Maandbudget
                  </span>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Wat gebeurt er als je € 4.000 investeert i.p.v. € 2.000?
                  </p>
                </div>
                <span className="text-sm font-black text-sky-300 bg-sky-400/20 border border-sky-400/30 px-2.5 py-1 rounded-lg">
                  {fmtAdminAmount(totals.marketingScenario.activeSpendCents)}/mnd
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[2000, 3000, 4000, 5000].map(amt => (
                  <button
                    key={amt}
                    onClick={() => handleQuickScenarioUpdate({ marketingScenarioSpendCents: amt * 100 })}
                    className={`py-2 px-1 text-center rounded-lg text-xs font-bold transition-all ${
                      totals.marketingScenario.activeSpendCents === amt * 100
                        ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30 ring-2 ring-sky-300'
                        : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                    }`}
                  >
                    € {amt.toLocaleString('nl-NL')}
                    {amt === 2000 && <span className="block text-[9px] font-normal opacity-80">Basis</span>}
                    {amt === 4000 && <span className="block text-[9px] font-normal opacity-80">Groeispurt</span>}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10 text-center">
                <div className="bg-white/5 rounded-lg p-2">
                  <span className="text-[10px] text-zinc-400 block">Extra Spend:</span>
                  <span className="text-xs font-bold text-white">
                    {totals.marketingScenario.deltaSpendCents > 0
                      ? `+${fmtAdminAmount(totals.marketingScenario.deltaSpendCents)}`
                      : '€ 0'}
                  </span>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <span className="text-[10px] text-zinc-400 block">Break-even Vaarten:</span>
                  <span className="text-xs font-bold text-amber-300">
                    +{totals.marketingScenario.breakevenCruisesNeeded} cruises
                  </span>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <span className="text-[10px] text-zinc-400 block">Verwachte Winst:</span>
                  <span className={`text-xs font-bold ${totals.marketingScenario.projectedNetExtraProfitCents >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totals.marketingScenario.projectedNetExtraProfitCents >= 0 ? '+' : ''}{fmtAdminAmount(totals.marketingScenario.projectedNetExtraProfitCents)}
                  </span>
                </div>
              </div>
            </div>

            {/* Module 2: Amsterdam Light Festival */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    Amsterdam Light Festival (€ 1.900 per categorie)
                  </span>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Inschrijfgeld voor dec &amp; jan vaarten
                  </p>
                </div>
                <span className="text-sm font-black text-amber-300 bg-amber-400/20 border border-amber-400/30 px-2.5 py-1 rounded-lg">
                  {fmtAdminAmount(totals.alfScenario.totalFeesCents)}
                </span>
              </div>

              <div className="space-y-2">
                {totals.alfScenario.categories.map(cat => (
                  <div
                    key={cat.id}
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      cat.active
                        ? 'bg-amber-400/10 border-amber-400/40 text-white'
                        : 'bg-white/5 border-white/10 text-zinc-400'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold">{cat.name}</span>
                      <p className="text-[10px] text-zinc-300">
                        Break-even: {cat.breakevenTickets} tickets à € 35 OF {cat.breakevenCruises} privécruises
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        const updated = totals.alfScenario.categories.map(c =>
                          c.id === cat.id ? { ...c, active: !c.active } : c
                        )
                        handleQuickScenarioUpdate({
                          alfCategories: updated.map(c => ({
                            id: c.id,
                            name: c.name,
                            active: c.active,
                            feeCents: c.feeCents,
                          })),
                        })
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                        cat.active
                          ? 'bg-amber-400 text-zinc-950 shadow-sm'
                          : 'bg-white/10 text-zinc-400 hover:bg-white/20'
                      }`}
                    >
                      {cat.active ? 'Meedoen ✓' : 'Niet meedoen'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Module 3: Leningen Details in Drawer */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                <CalendarCheck className="w-3.5 h-3.5 text-rose-400" />
                Leningen Overzicht ({totals.loansSummary.length})
              </span>
              <span className="text-xs text-zinc-400">
                Totale Restschuld: <strong className="text-white">{fmtAdminAmount(totals.remainingLoanPrincipalCents)}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {totals.loansSummary.map(loan => (
                <div key={loan.id} className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>{loan.name}</span>
                    <span className="text-rose-300">{loan.interestRatePct}% rente</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Restschuld:</span>
                    <span className="text-white font-bold">{fmtAdminAmount(loan.remainingPrincipalCents)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Aflossing:</span>
                    <span>{fmtAdminAmount(loan.monthlyPrincipalCents)}/mnd</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-rose-950 flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-rose-700" />
                    Leningen &amp; Financiering ({settingsForm.loans.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const newId = `loan-${Date.now()}`
                      setSettingsForm({
                        ...settingsForm,
                        loans: [
                          ...settingsForm.loans,
                          {
                            id: newId,
                            name: `Lening #${settingsForm.loans.length + 1}`,
                            principalTotalCents: 1500000,
                            monthlyPrincipalCents: 30000,
                            monthlyInterestCents: 7000,
                            interestRatePct: 5.5,
                            targetPayoffYear: 2028,
                          },
                        ],
                      })
                    }}
                    className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 hover:bg-rose-200 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Lening Toevoegen
                  </button>
                </div>

                <div className="space-y-3">
                  {settingsForm.loans.map((loan, idx) => (
                    <div key={loan.id} className="bg-white/80 border border-rose-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          className="font-bold text-xs text-zinc-900 border-b border-dashed border-zinc-300 pb-0.5 w-full bg-transparent"
                          value={loan.name}
                          onChange={e => {
                            const updated = settingsForm.loans.map(l =>
                              l.id === loan.id ? { ...l, name: e.target.value } : l
                            )
                            setSettingsForm({ ...settingsForm, loans: updated })
                          }}
                        />
                        {settingsForm.loans.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettingsForm({
                                ...settingsForm,
                                loans: settingsForm.loans.filter(l => l.id !== loan.id),
                              })
                            }}
                            className="text-zinc-400 hover:text-rose-600 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="text-[10px] text-zinc-500 font-semibold">Hoofdsom (€)</label>
                          <input
                            type="number"
                            step="500"
                            className="w-full border border-zinc-200 rounded p-1.5 text-xs text-zinc-900 bg-white"
                            value={Math.round(loan.principalTotalCents / 100)}
                            onChange={e => {
                              const val = Number(e.target.value) * 100
                              const updated = settingsForm.loans.map(l =>
                                l.id === loan.id ? { ...l, principalTotalCents: val } : l
                              )
                              setSettingsForm({ ...settingsForm, loans: updated })
                            }}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-zinc-500 font-semibold">Aflossing (€/mnd)</label>
                          <input
                            type="number"
                            step="25"
                            className="w-full border border-zinc-200 rounded p-1.5 text-xs text-zinc-900 bg-white"
                            value={Math.round(loan.monthlyPrincipalCents / 100)}
                            onChange={e => {
                              const val = Number(e.target.value) * 100
                              const updated = settingsForm.loans.map(l =>
                                l.id === loan.id ? { ...l, monthlyPrincipalCents: val } : l
                              )
                              setSettingsForm({ ...settingsForm, loans: updated })
                            }}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-zinc-500 font-semibold">Rente (€/mnd)</label>
                          <input
                            type="number"
                            step="10"
                            className="w-full border border-zinc-200 rounded p-1.5 text-xs text-zinc-900 bg-white"
                            value={Math.round(loan.monthlyInterestCents / 100)}
                            onChange={e => {
                              const val = Number(e.target.value) * 100
                              const updated = settingsForm.loans.map(l =>
                                l.id === loan.id ? { ...l, monthlyInterestCents: val } : l
                              )
                              setSettingsForm({ ...settingsForm, loans: updated })
                            }}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-zinc-500 font-semibold">Rente (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            className="w-full border border-zinc-200 rounded p-1.5 text-xs text-zinc-900 bg-white"
                            value={loan.interestRatePct}
                            onChange={e => {
                              const val = Number(e.target.value)
                              const updated = settingsForm.loans.map(l =>
                                l.id === loan.id ? { ...l, interestRatePct: val } : l
                              )
                              setSettingsForm({ ...settingsForm, loans: updated })
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Amsterdam Light Festival (ALF) Categorieën Blok */}
              <div className="bg-indigo-50/60 border border-indigo-200/80 p-3.5 rounded-xl space-y-3">
                <h4 className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-700" />
                  Amsterdam Light Festival (ALF) Categorieën &amp; Fees
                </h4>

                <div className="space-y-2">
                  {settingsForm.alfCategories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-indigo-100 text-xs">
                      <div className="space-y-0.5">
                        <span className="font-semibold text-zinc-900">{cat.name}</span>
                        <p className="text-[10px] text-zinc-500">Inschrijfgeld: € {Math.round(cat.feeCents / 100)} per seizoen</p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-zinc-500">Fee: €</span>
                          <input
                            type="number"
                            step="100"
                            className="w-20 border border-zinc-200 rounded p-1 text-xs text-zinc-900 text-right"
                            value={Math.round(cat.feeCents / 100)}
                            onChange={e => {
                              const val = Number(e.target.value) * 100
                              const updated = settingsForm.alfCategories.map(c =>
                                c.id === cat.id ? { ...c, feeCents: val } : c
                              )
                              setSettingsForm({ ...settingsForm, alfCategories: updated })
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const updated = settingsForm.alfCategories.map(c =>
                              c.id === cat.id ? { ...c, active: !c.active } : c
                            )
                            setSettingsForm({ ...settingsForm, alfCategories: updated })
                          }}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            cat.active
                              ? 'bg-indigo-600 text-white'
                              : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                          }`}
                        >
                          {cat.active ? 'Actief ✓' : 'Inactief'}
                        </button>
                      </div>
                    </div>
                  ))}
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
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-zinc-900 flex items-center gap-1.5">
                    <Anchor className="w-4 h-4 text-zinc-700" />
                    Liggeld &amp; Vaste Seizoensbuffer
                  </h4>
                  <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                    1/4 in okt, nov, feb, mrt
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                    <label className="font-semibold text-zinc-700">Liggeld (€/boot/jaar ex)</label>
                    <input
                      type="number"
                      step="500"
                      className="w-full border border-zinc-200 rounded-lg p-2 text-sm text-zinc-900 bg-white"
                      value={settingsForm.berthFeePerBoatYearlyEuros}
                      onChange={e => setSettingsForm({ ...settingsForm, berthFeePerBoatYearlyEuros: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-zinc-400">Jaarlijks tarief Waternet (bv. € 4.000)</p>
                  </div>
                </div>

                <div className="bg-blue-50/70 border border-blue-200/60 rounded-lg p-2.5 text-[11px] text-blue-900 space-y-0.5">
                  <span className="font-bold">📌 Seizoensreservering voor Waternet:</span>
                  <p className="text-blue-800/80">
                    Er wordt telkens 25% (€ {Math.round((settingsForm.boatCount * settingsForm.berthFeePerBoatYearlyEuros) / 4).toLocaleString('nl-NL')}) opzij gezet in oktober, november, februari en maart. Zo blijft de zomersprint maximaal liquide en staat het geld klaar voor de factuur.
                  </p>
                </div>
              </div>

              {/* Vaste Bedrijfsabonnementen (Itemized) */}
              <div className="bg-amber-50/40 border border-amber-200/80 p-3.5 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-zinc-900 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-amber-600" />
                      Vaste Abonnementen &amp; Bedrijfskosten ({settingsForm.fixedCostItems.length})
                    </h4>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      Voeg abonnementen toe zoals mobiele telefoon, software of verzekering
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddFixedCostItem}
                    className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Abonnement Toevoegen
                  </button>
                </div>

                <div className="space-y-2">
                  {settingsForm.fixedCostItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 bg-white border border-zinc-200 p-2 rounded-lg">
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => handleUpdateFixedCostItem(item.id, { name: e.target.value })}
                        className="flex-1 px-2 py-1 text-xs border border-zinc-200 rounded text-zinc-900"
                        placeholder="Naam (bv. Telefoon KPN)"
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-zinc-400">€</span>
                        <input
                          type="number"
                          step="5"
                          value={Math.round(item.monthlyCents / 100)}
                          onChange={e => handleUpdateFixedCostItem(item.id, { monthlyCents: Math.round(Number(e.target.value) * 100) })}
                          className="w-20 px-2 py-1 text-xs border border-zinc-200 rounded text-zinc-900 text-right font-medium"
                          placeholder="45"
                        />
                        <span className="text-[10px] text-zinc-400">/mnd</span>
                      </div>
                      {settingsForm.fixedCostItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveFixedCostItem(item.id)}
                          className="text-zinc-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center pt-1 text-xs font-semibold text-zinc-700">
                  <span>Totale vaste abonnementen:</span>
                  <span className="text-zinc-900 font-bold">
                    € {Math.round(settingsForm.fixedCostItems.reduce((s, i) => s + i.monthlyCents, 0) / 100).toLocaleString('nl-NL')} / maand
                  </span>
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
