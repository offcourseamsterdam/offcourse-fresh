'use client'

import { useState } from 'react'
import { eur, pct } from './money'

interface ChartSlice {
  key: string
  label: string
  sublabel?: string
  valueCents: number
  color: string
  highlight?: boolean
}

const EXPENSE_DATA: ChartSlice[] = [
  { key: 'owner_salary', label: 'Eigenaars (Beer & Jannah)', sublabel: 'Eigenaarsvergoeding', valueCents: 800000, color: '#8b5cf6' },
  { key: 'crew', label: 'Schippers & Crew (extern)', sublabel: 'Inhuur zzp schippers', valueCents: 469292, color: '#ef4444' },
  { key: 'mooring', label: 'Ligplaatsen Westerdok', sublabel: 'Vaste ligplaatsen', valueCents: 443667, color: '#f97316' },
  { key: 'catering', label: 'Catering, Wijn & IJs', sublabel: 'Drank en catering inkopen', valueCents: 330743, color: '#ec4899' },
  { key: 'marketing', label: 'Marketing & Pride', sublabel: 'Advertenties & events', valueCents: 119248, color: '#3b82f6' },
  { key: 'insurance', label: 'Verzekeringen (EOC)', sublabel: 'Casco & aansprakelijkheid', valueCents: 112452, color: '#06b6d4' },
  { key: 'upgrades', label: 'Boot Upgrades', sublabel: 'Onderdelen & uitrusting', valueCents: 84570, color: '#10b981' },
  { key: 'commissions', label: 'Partner & Affiliate Commissies', sublabel: 'o.a. Things To Do In Amsterdam', valueCents: 53573, color: '#f59e0b', highlight: true },
  { key: 'other', label: 'Software, Bank & Overig', sublabel: 'Boekhouding, apps, kosten', valueCents: 229794, color: '#64748b' },
]

const REVENUE_DATA: ChartSlice[] = [
  { key: 'stripe', label: 'Eigen Website (Stripe)', sublabel: 'Directe boekingen (hoogste marge)', valueCents: 2362549, color: '#6366f1' },
  { key: 'getyourguide', label: 'GetYourGuide', sublabel: 'Reseller platform', valueCents: 597864, color: '#f97316' },
  { key: 'viator', label: 'Viator', sublabel: 'TripAdvisor reseller platform', valueCents: 435534, color: '#10b981' },
  { key: 'boatlocal', label: 'BoatLocal (Platform)', sublabel: 'Binnenlandse platform payout', valueCents: 329089, color: '#0ea5e9' },
  { key: 'zettle', label: 'Zettle (Bar/Pin aan boord)', sublabel: 'Drankafrekening tijdens vaart', valueCents: 274596, color: '#14b8a6', highlight: true },
  { key: 'withlocals', label: 'Withlocals', sublabel: 'Tours & experience platform', valueCents: 217946, color: '#eab308' },
  { key: 'invoices', label: 'Zakelijke Facturen', sublabel: 'B2B op factuurbasis', valueCents: 85550, color: '#a855f7' },
  { key: 'fareharbor', label: 'FareHarbor', sublabel: 'Directe partner integratie', valueCents: 23247, color: '#64748b' },
]

const COMPARE_DATA: ChartSlice[] = [
  { key: 'costs', label: 'Totale Uitgaven', sublabel: 'Exploitatie & Eigenaarsvergoeding', valueCents: 2643349, color: '#f43f5e' },
  { key: 'profit', label: 'Netto Vrij Bedrijfsresultaat', sublabel: 'Resterend na alle kosten & salaris', valueCents: 1683026, color: '#10b981', highlight: true },
]

interface DonutChartProps {
  title: string
  subtitle: string
  badgeText: string
  badgeTone?: 'rose' | 'emerald' | 'indigo'
  data: ChartSlice[]
  totalCents: number
  centerLabel: string
  centerValue: string
  centerSubvalue?: string
}

function DonutChart({
  title,
  subtitle,
  badgeText,
  badgeTone = 'indigo',
  data,
  totalCents,
  centerLabel,
  centerValue,
  centerSubvalue,
}: DonutChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const radius = 110
  const strokeWidth = 36
  const circumference = 2 * Math.PI * radius
  let accumulatedPercent = 0

  const hoveredSlice = data.find(d => d.key === hoveredKey)

  const badgeColorClass =
    badgeTone === 'rose'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : badgeTone === 'emerald'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-indigo-50 text-indigo-700 border-indigo-200'

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm flex flex-col justify-between transition-all">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <div>
            <h3 className="font-semibold text-zinc-900 text-sm sm:text-base">{title}</h3>
            <p className="text-xs text-zinc-500">{subtitle}</p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${badgeColorClass}`}>
            {badgeText}
          </span>
        </div>

        {/* SVG Donut */}
        <div className="relative flex justify-center items-center my-4 sm:my-6">
          <svg viewBox="0 0 320 320" className="w-44 h-44 sm:w-56 sm:h-56 max-w-full -rotate-90">
            {data.map(slice => {
              const percent = totalCents > 0 ? slice.valueCents / totalCents : 0
              const strokeDasharray = `${percent * circumference} ${circumference}`
              const strokeDashoffset = -accumulatedPercent * circumference
              accumulatedPercent += percent

              const isHovered = hoveredKey === slice.key
              const isOtherHovered = hoveredKey !== null && !isHovered

              return (
                <circle
                  key={slice.key}
                  cx={160}
                  cy={160}
                  r={radius}
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth={isHovered ? strokeWidth + 6 : strokeWidth}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-200 cursor-pointer origin-center"
                  style={{
                    opacity: isOtherHovered ? 0.35 : 1,
                    filter: isHovered ? 'brightness(1.1) drop-shadow(0 2px 8px rgba(0,0,0,0.15))' : undefined,
                  }}
                  onMouseEnter={() => setHoveredKey(slice.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                />
              )
            })}
          </svg>

          {/* Center Info */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
            {hoveredSlice ? (
              <>
                <span className="text-[11px] text-zinc-500 font-medium line-clamp-1 max-w-[130px]">
                  {hoveredSlice.label}
                </span>
                <span className="text-base sm:text-lg font-bold text-zinc-900 tabular-nums">
                  {eur(hoveredSlice.valueCents)}
                </span>
                <span className="text-[11px] font-semibold text-indigo-600 mt-0.5">
                  {pct((hoveredSlice.valueCents / totalCents) * 100)}
                </span>
              </>
            ) : (
              <>
                <span className="text-[11px] text-zinc-400 font-medium uppercase tracking-wide">
                  {centerLabel}
                </span>
                <span className="text-base sm:text-lg font-bold text-zinc-900 tabular-nums">
                  {centerValue}
                </span>
                {centerSubvalue && (
                  <span className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                    {centerSubvalue}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Legend List */}
      <div className="space-y-1.5 pt-3 border-t border-zinc-100 max-h-56 overflow-y-auto pr-1 text-xs">
        {data.map(slice => {
          const percent = totalCents > 0 ? (slice.valueCents / totalCents) * 100 : 0
          const isHovered = hoveredKey === slice.key

          return (
            <div
              key={slice.key}
              onMouseEnter={() => setHoveredKey(slice.key)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex items-center justify-between py-1 px-1.5 rounded-lg transition-colors cursor-pointer ${
                isHovered
                  ? 'bg-zinc-100 font-medium'
                  : slice.highlight
                    ? 'bg-amber-50/70 border border-amber-200/60'
                    : 'hover:bg-zinc-50'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                <span className={`truncate ${slice.highlight ? 'font-semibold text-amber-950' : 'text-zinc-700'}`}>
                  {slice.label}
                </span>
              </div>
              <span className={`tabular-nums shrink-0 font-semibold ${slice.highlight ? 'text-amber-900' : 'text-zinc-900'}`}>
                {eur(slice.valueCents)}{' '}
                <span className="text-zinc-400 font-normal">({pct(percent)})</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function FinancialPieCharts() {
  const [activeTab, setActiveTab] = useState<'all' | 'expenses' | 'revenue' | 'compare'>('all')

  const totalExpensesCents = EXPENSE_DATA.reduce((sum, d) => sum + d.valueCents, 0)
  const totalRevenueCents = REVENUE_DATA.reduce((sum, d) => sum + d.valueCents, 0)

  return (
    <section className="space-y-4">
      {/* Header bar with Segmented Control */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
              <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
                Financiële Visuele Analyse
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-zinc-900 mt-1">Omzet- & Kostenstructuur</h2>
            <p className="text-xs sm:text-sm text-zinc-500">
              Realtime uitsplitsing inclusief Zettle bar/pin en aparte partner- & affiliate commissies
            </p>
          </div>

          <div className="flex gap-2 sm:gap-3 flex-wrap">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-right">
              <div className="text-[10px] sm:text-[11px] font-medium text-emerald-800">Totale Omzet</div>
              <div className="text-sm sm:text-base font-bold text-emerald-950 tabular-nums">€ 43.263,75</div>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-right">
              <div className="text-[10px] sm:text-[11px] font-medium text-rose-800">Totale Kosten</div>
              <div className="text-sm sm:text-base font-bold text-rose-950 tabular-nums">€ 26.433,49</div>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-right">
              <div className="text-[10px] sm:text-[11px] font-medium text-indigo-800">Netto Marge</div>
              <div className="text-sm sm:text-base font-bold text-indigo-950 tabular-nums">+€ 16.830,26</div>
            </div>
          </div>
        </div>

        {/* Segmented Control Switcher */}
        <div className="flex items-center justify-between border-t border-zinc-100 pt-3 flex-wrap gap-2">
          <div className="inline-flex rounded-xl bg-zinc-100 p-1 border border-zinc-200/80 w-full sm:w-auto overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activeTab === 'all'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Alle grafieken
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('expenses')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activeTab === 'expenses'
                  ? 'bg-white text-rose-700 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              1. Kostenverdeling
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('revenue')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activeTab === 'revenue'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              2. Omzetkanalen
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('compare')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activeTab === 'compare'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              3. Marge & Resultaat
            </button>
          </div>

          <span className="text-xs text-zinc-400 hidden lg:inline">
            Tip: Schakel naar één specifieke grafiek voor een rustig detailoverzicht
          </span>
        </div>
      </div>

      {/* Dynamic Chart Presentation */}
      {activeTab === 'all' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Chart 1: Kostenverdeling */}
          <DonutChart
            title="1. Kostenverdeling"
            subtitle="Waar gaat het geld naartoe?"
            badgeText={eur(totalExpensesCents)}
            badgeTone="rose"
            data={EXPENSE_DATA}
            totalCents={totalExpensesCents}
            centerLabel="Totale kosten"
            centerValue={eur(totalExpensesCents)}
          />

          {/* Chart 2: Omzetkanalen */}
          <DonutChart
            title="2. Omzetkanalen"
            subtitle="Inclusief Zettle bar uitsplitsing"
            badgeText={eur(totalRevenueCents)}
            badgeTone="emerald"
            data={REVENUE_DATA}
            totalCents={totalRevenueCents}
            centerLabel="Totale omzet"
            centerValue={eur(totalRevenueCents)}
          />

          {/* Chart 3: Omzet vs Kosten */}
          <DonutChart
            title="3. Omzet vs Kosten"
            subtitle="Marge en netto resultaat"
            badgeText="38,9% Marge"
            badgeTone="indigo"
            data={COMPARE_DATA}
            totalCents={totalRevenueCents}
            centerLabel="Netto Saldo"
            centerValue="+€ 16.830"
            centerSubvalue="38,9% netto marge"
          />
        </div>
      ) : activeTab === 'expenses' ? (
        <div className="max-w-2xl mx-auto">
          <DonutChart
            title="1. Kostenverdeling (Volledig Overzicht)"
            subtitle="Gedetailleerde uitsplitsing van alle exploitatie- en bedrijfskosten"
            badgeText={eur(totalExpensesCents)}
            badgeTone="rose"
            data={EXPENSE_DATA}
            totalCents={totalExpensesCents}
            centerLabel="Totale kosten"
            centerValue={eur(totalExpensesCents)}
          />
        </div>
      ) : activeTab === 'revenue' ? (
        <div className="max-w-2xl mx-auto">
          <DonutChart
            title="2. Omzetkanalen & Boekingsbronnen"
            subtitle="Direct Stripe, Zettle baromzet en externe boekingsplatformen"
            badgeText={eur(totalRevenueCents)}
            badgeTone="emerald"
            data={REVENUE_DATA}
            totalCents={totalRevenueCents}
            centerLabel="Totale omzet"
            centerValue={eur(totalRevenueCents)}
          />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto">
          <DonutChart
            title="3. Omzet vs Uitgaven & Netto Resultaat"
            subtitle="Bruto P&L verhouding en overblijvende operationele winstmarge"
            badgeText="38,9% Marge"
            badgeTone="indigo"
            data={COMPARE_DATA}
            totalCents={totalRevenueCents}
            centerLabel="Netto Saldo"
            centerValue="+€ 16.830"
            centerSubvalue="38,9% netto marge"
          />
        </div>
      )}

      {/* Affiliate & Reseller Callout Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center justify-center font-bold text-base shrink-0">
            🤝
          </div>
          <div>
            <div className="font-semibold text-sm text-amber-200">
              Partner- & Affiliate Commissies Inzicht
            </div>
            <div className="text-zinc-300 mt-0.5 leading-relaxed">
              Van de € 23.625 website-omzet is slechts <strong className="text-white">€ 535,73 (2,0% van de totale uitgaven)</strong> achteraf als commissie betaald aan Things To Do In Amsterdam. De overige <strong className="text-emerald-400">98% is directe winst</strong>.
            </div>
          </div>
        </div>
        <div className="text-zinc-400 text-right shrink-0 hidden md:block">
          <span className="inline-block px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300">
            Kasboek & Bank Reconciled
          </span>
        </div>
      </div>
    </section>
  )
}
