'use client'

import { useMemo, useState } from 'react'
import {
  Ship,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Info,
  Sliders,
  DollarSign,
  Users,
} from 'lucide-react'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import {
  run12MonthSimulation,
  type SimulationParams,
} from '@/lib/finance/cockpit/simulator/simulation-engine'
import { eur, pct } from '@/components/admin/finance/cockpit/money'
import { AdminEyebrow } from '@/components/admin/ui/AdminEyebrow'

export default function FinanceScenariosPage() {
  // Simulator state parameters
  const [fleetSize, setFleetSize] = useState<number>(2)
  const [occupancyPct, setOccupancyPct] = useState<number>(18.2)
  const [scenarioPreset, setScenarioPreset] = useState<'realistic' | 'bull' | 'stress'>('realistic')
  const [fbSpendPerGuest, setFbSpendPerGuest] = useState<number>(3.2)
  const [directRatioPct, setDirectRatioPct] = useState<number>(54.6)
  const [ownerSalaryMonthly, setOwnerSalaryMonthly] = useState<number>(8000)

  // Boat 3 purchase simulator
  const [expansionEnabled, setExpansionEnabled] = useState<boolean>(false)
  const [expansionMonthIndex, setExpansionMonthIndex] = useState<number>(6) // March 2027
  const [expansionCapex, setExpansionCapex] = useState<number>(65000)
  const [financingType, setFinancingType] = useState<'cash' | 'debt_50' | 'debt_100'>('debt_50')

  // Run simulation reactively
  const params: SimulationParams = useMemo(
    () => ({
      startingCashCents: 2000000, // € 20.000 current Revolut cash
      fleetSize,
      occupancyPct,
      scenarioPreset,
      fbSpendPerGuestCents: Math.round(fbSpendPerGuest * 100),
      directBookingRatioPct: directRatioPct,
      ownerSalaryMonthlyCents: Math.round(ownerSalaryMonthly * 100),
      expansionEnabled,
      expansionMonthIndex,
      expansionCapexCents: Math.round(expansionCapex * 100),
      expansionFinancingType: financingType,
    }),
    [
      fleetSize,
      occupancyPct,
      scenarioPreset,
      fbSpendPerGuest,
      directRatioPct,
      ownerSalaryMonthly,
      expansionEnabled,
      expansionMonthIndex,
      expansionCapex,
      financingType,
    ],
  )

  const summary = useMemo(() => run12MonthSimulation(params), [params])

  const cardClass = 'rounded-2xl border border-zinc-200 bg-white shadow-sm'

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <FinanceSubnav />

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <AdminEyebrow label="Performance" />
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              12-Maands Cashflow Simulator
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 mt-1">
            Scenario Planner & Stresstest
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Simuleer vlootgroei, seizoenseffecten, boot 3 aankoop en schuldaflossingscapaciteit.
          </p>
        </div>

        {/* Quick Presets */}
        <div className="inline-flex rounded-xl bg-zinc-100 p-1 border border-zinc-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setScenarioPreset('stress')
              setOccupancyPct(14)
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              scenarioPreset === 'stress'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            🌧️ Koude Winter Stress
          </button>
          <button
            type="button"
            onClick={() => {
              setScenarioPreset('realistic')
              setOccupancyPct(18.2)
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              scenarioPreset === 'realistic'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            ⚓ Basis Realistisch
          </button>
          <button
            type="button"
            onClick={() => {
              setScenarioPreset('bull')
              setOccupancyPct(28)
              setFbSpendPerGuest(7.5)
              setDirectRatioPct(70)
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              scenarioPreset === 'bull'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            ☀️ Bull Markt
          </button>
        </div>
      </div>

      {/* Top Projections KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${cardClass} p-4 sm:p-5 flex flex-col justify-between`}>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">12M Geprojecteerde Omzet</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-zinc-900 tabular-nums my-1">
            {eur(summary.totalAnnualRevenueCents)}
          </p>
          <p className="text-xs text-zinc-500">
            Tickets + F&B over alle {params.fleetSize + (expansionEnabled ? 1 : 0)} boten
          </p>
        </div>

        <div className={`${cardClass} p-4 sm:p-5 flex flex-col justify-between`}>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Netto Surplus (Vrije Kasstroom)</p>
          <p className={`text-2xl sm:text-3xl font-extrabold tabular-nums my-1 ${
            summary.totalAnnualNetSurplusCents >= 0 ? 'text-emerald-600' : 'text-rose-600'
          }`}>
            {summary.totalAnnualNetSurplusCents >= 0 ? '+' : ''}{eur(summary.totalAnnualNetSurplusCents)}
          </p>
          <p className="text-xs text-zinc-500">Na alle kosten, rente, schuld & salaris</p>
        </div>

        <div className={`${cardClass} p-4 sm:p-5 flex flex-col justify-between`}>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Laagste Kassaldo (Runway Dal)</p>
          <p className={`text-2xl sm:text-3xl font-extrabold tabular-nums my-1 ${
            summary.minimumCashCents < 500000 ? 'text-rose-600' : summary.minimumCashCents < 1500000 ? 'text-amber-600' : 'text-indigo-950'
          }`}>
            {eur(summary.minimumCashCents)}
          </p>
          <p className="text-xs text-zinc-500">
            Dieptepunt bereikt in <strong className="text-zinc-800 font-semibold">{summary.minimumCashMonth}</strong>
          </p>
        </div>

        <div className={`${cardClass} p-4 sm:p-5 flex flex-col justify-between`}>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Gemiddelde DSCR Dekking</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tabular-nums my-1">
            {summary.averageDscr}x
          </p>
          <p className="text-xs text-zinc-500">
            {summary.averageDscr >= 2.0 ? 'Comfortabel (>2.0x vereist)' : 'Onder verhoogde waakzaamheid'}
          </p>
        </div>
      </div>

      {/* Sliders & Parameters Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: The Control Board */}
        <div className={`${cardClass} p-5 sm:p-6 lg:col-span-2 space-y-6`}>
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-600" />
              <h2 className="font-bold text-zinc-900 text-base">Strategische Parameters</h2>
            </div>
            <span className="text-xs text-zinc-400">Veranderingen worden direct doorgerekend</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Slider 1: Vlootbezetting */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700">Vlootbezetting (Tijdsloten)</span>
                <span className="font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded tabular-nums">
                  {occupancyPct}%
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="65"
                step="0.5"
                value={occupancyPct}
                onChange={e => setOccupancyPct(Number(e.target.value))}
                className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <p className="text-[11px] text-zinc-400">
                Huidig: 18,2% (gem. 1,8 afvaarten per boot per dag)
              </p>
            </div>

            {/* Slider 2: Onboard F&B Spend */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700">Onboard Drankbesteding (RevPAX)</span>
                <span className="font-extrabold text-teal-700 bg-teal-50 px-2 py-0.5 rounded tabular-nums">
                  € {fbSpendPerGuest.toFixed(2)} / gast
                </span>
              </div>
              <input
                type="range"
                min="2.5"
                max="14.0"
                step="0.5"
                value={fbSpendPerGuest}
                onChange={e => setFbSpendPerGuest(Number(e.target.value))}
                className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
              />
              <p className="text-[11px] text-zinc-400">
                Huidig: € 3,20. Met samengestelde drankarrangementen kan dit naar € 8,50+.
              </p>
            </div>

            {/* Slider 3: Direct Website Ratio */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700">Direct Kanaal aandeel (0% Fee)</span>
                <span className="font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded tabular-nums">
                  {directRatioPct}%
                </span>
              </div>
              <input
                type="range"
                min="40"
                max="90"
                step="1"
                value={directRatioPct}
                onChange={e => setDirectRatioPct(Number(e.target.value))}
                className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              />
              <p className="text-[11px] text-zinc-400">
                Resterend betaalt 20-25% commissie aan GetYourGuide & Viator.
              </p>
            </div>

            {/* Slider 4: Eigenaarsvergoeding */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700">Eigenaarsvergoeding (Beer & Jannah)</span>
                <span className="font-extrabold text-zinc-900 bg-zinc-100 px-2 py-0.5 rounded tabular-nums">
                  € {ownerSalaryMonthly.toLocaleString('nl-NL')} / mnd
                </span>
              </div>
              <input
                type="range"
                min="4000"
                max="14000"
                step="500"
                value={ownerSalaryMonthly}
                onChange={e => setOwnerSalaryMonthly(Number(e.target.value))}
                className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-900"
              />
              <p className="text-[11px] text-zinc-400">
                Standaard: € 8.000 / maand (€ 96.000 op jaarbasis).
              </p>
            </div>
          </div>

          {/* Dedicated Expansion Box: Boot 3 Aankoop */}
          <div className="rounded-xl border-2 border-indigo-200/80 bg-indigo-50/40 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-indigo-700" />
                <span className="font-bold text-sm text-zinc-900">
                  Boot 3 Vlootexpansie Investeringssimulatie
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={expansionEnabled}
                  onChange={e => setExpansionEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {expansionEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-indigo-100">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-zinc-700">Aankoopmaand</label>
                  <select
                    value={expansionMonthIndex}
                    onChange={e => setExpansionMonthIndex(Number(e.target.value))}
                    className="w-full text-xs font-medium rounded-lg border border-zinc-200 bg-white p-2"
                  >
                    <option value={4}>Januari 2027</option>
                    <option value={5}>Februari 2027</option>
                    <option value={6}>Maart 2027 (Start Seizoen)</option>
                    <option value={7}>April 2027 (Koningsdag)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-zinc-700">Investering (Capex)</label>
                  <select
                    value={expansionCapex}
                    onChange={e => setExpansionCapex(Number(e.target.value))}
                    className="w-full text-xs font-medium rounded-lg border border-zinc-200 bg-white p-2"
                  >
                    <option value={55000}>€ 55.000 (Occasion retrofit)</option>
                    <option value={65000}>€ 65.000 (Standaard salonboot)</option>
                    <option value={85000}>€ 85.000 (Custom luxe elektrisch)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-zinc-700">Financieringsmix</label>
                  <select
                    value={financingType}
                    onChange={e => setFinancingType(e.target.value as any)}
                    className="w-full text-xs font-medium rounded-lg border border-zinc-200 bg-white p-2"
                  >
                    <option value="debt_50">50% Cash / 50% Lening</option>
                    <option value="debt_100">100% Nieuwe Lening</option>
                    <option value="cash">100% Eigen Cash</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: AI CFO Verdict Card */}
        <div className={`${cardClass} p-5 sm:p-6 flex flex-col justify-between space-y-4 border-indigo-200`}>
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-zinc-100">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-zinc-900 text-base">CFO Scenario Verdict</h3>
            </div>

            <div className="mt-4 space-y-3">
              <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                summary.cfoVerdict.canAffordExpansion
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50/70 border-amber-200 text-amber-950'
              }`}>
                {summary.cfoVerdict.canAffordExpansion ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider">
                    {summary.cfoVerdict.verdictTitle}
                  </h4>
                  <p className="text-xs mt-1 leading-relaxed text-zinc-700">
                    {summary.cfoVerdict.verdictDescription}
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400">
                  CFO Aanbevelingen
                </span>
                <ul className="space-y-2 text-xs text-zinc-700">
                  {summary.cfoVerdict.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-indigo-600 font-bold shrink-0">→</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-100 text-[11px] text-zinc-400 flex items-center justify-between">
            <span>Inclusief 1 okt rente & 1 apr termijn</span>
            <span className="font-semibold text-zinc-600">Model: Deterministic 12M</span>
          </div>
        </div>
      </div>

      {/* 12-Month Projections Table */}
      <div className={`${cardClass} p-5 sm:p-6 space-y-4`}>
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-zinc-700" />
            <h3 className="font-bold text-zinc-900 text-base">Maandelijkse Cashflow Projectie (Sep 2026 – Aug 2027)</h3>
          </div>
          <span className="text-xs text-zinc-400">
            Bedragen in euro's (afgerond)
          </span>
        </div>

        <div className="overflow-x-auto -mx-5 sm:mx-0">
          <table className="w-full text-xs min-w-[700px]">
            <thead className="bg-zinc-50/80 text-zinc-500 border-y border-zinc-100">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold">Maand</th>
                <th className="text-center px-2 py-2.5 font-semibold">Vloot</th>
                <th className="text-right px-3 py-2.5 font-semibold">Omzet</th>
                <th className="text-right px-3 py-2.5 font-semibold">Kosten</th>
                <th className="text-right px-3 py-2.5 font-semibold">Schuldendienst</th>
                <th className="text-right px-3 py-2.5 font-semibold">Salaris</th>
                <th className="text-right px-3 py-2.5 font-semibold">Netto</th>
                <th className="text-right px-3 py-2.5 font-semibold">Kassaldo</th>
                <th className="text-center px-2 py-2.5 font-semibold">DSCR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {summary.projections.map(p => {
                const totalOperatingCosts = p.commissionExpenseCents + p.variableCostsCents + p.fixedOverheadCents
                const isSpecialMonth = p.debtServicePrincipalCents > 0 || (p.debtServiceInterestCents > 0 && p.calendarMonth === 10)
                return (
                  <tr
                    key={p.monthIndex}
                    className={`hover:bg-zinc-50/80 transition-colors ${
                      isSpecialMonth ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium text-zinc-900 whitespace-nowrap">
                      {p.monthLabel}
                      {p.calendarMonth === 10 && (
                        <span className="ml-1.5 px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                          1 Okt rente
                        </span>
                      )}
                      {p.calendarMonth === 4 && (
                        <span className="ml-1.5 px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold text-[10px]">
                          1 Apr aflossing
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold text-zinc-700">
                      {p.activeBoats}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-zinc-900 tabular-nums">
                      {eur(p.revenueCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-zinc-600 tabular-nums">
                      {eur(totalOperatingCosts)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {p.debtServiceInterestCents + p.debtServicePrincipalCents > 0 ? (
                        <span className="font-bold text-amber-900">
                          {eur(p.debtServiceInterestCents + p.debtServicePrincipalCents)}
                        </span>
                      ) : (
                        <span className="text-zinc-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-zinc-600 tabular-nums">
                      {eur(p.ownerSalaryCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                      <span className={p.netSurplusCents >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                        {p.netSurplusCents >= 0 ? '+' : ''}{eur(p.netSurplusCents)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-extrabold tabular-nums">
                      <span className={p.endingCashCents < 500000 ? 'text-rose-600' : p.endingCashCents < 1500000 ? 'text-amber-600' : 'text-zinc-900'}>
                        {eur(p.endingCashCents)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold">
                      <span className={p.dscr >= 2.0 ? 'text-emerald-700' : p.dscr >= 1.2 ? 'text-amber-600' : 'text-rose-600'}>
                        {p.dscr}x
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
