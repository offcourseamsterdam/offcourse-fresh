'use client'

import { Fragment, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, RefreshCw, Receipt, ArrowRight, AlertTriangle, Upload, ChevronDown, ChevronRight, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { FinanceShareLinks } from '@/components/admin/FinanceShareLinks'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { InvoicesTab } from '@/components/admin/finance/InvoicesTab'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useFinanceUpload } from '@/hooks/useFinanceUpload'
import { fmtAdminAmount, fmtAdminAmountRounded, fmtAdminDate } from '@/lib/admin/format'
import { quarterLabel, quarterFromDate } from '@/lib/quarters'
import type { QuarterVatSummary, VatSummaryTotals } from '@/lib/finance/vat-stripe-summary'
import type { QuarterViatorSummary, ViatorSummaryTotals } from '@/lib/finance/viator-summary'
import type { QuarterGetYourGuideSummary, GetYourGuideSummaryTotals } from '@/lib/finance/getyourguide-summary'
import type { QuarterBoatLocalSummary, BoatLocalSummaryTotals } from '@/lib/finance/boatlocal-summary'
import type { QuarterZettleSummary, ZettleSummaryTotals } from '@/lib/finance/zettle-sales'
import type { MonthWithlocalsSummary, WithlocalsSummaryTotals } from '@/lib/finance/withlocals-summary'
import type { QuarterClickAndBoatSummary, ClickAndBoatSummaryTotals } from '@/lib/finance/clickandboat-summary'
import type { QuarterGetMyBoatSummary, GetMyBoatSummaryTotals } from '@/lib/finance/getmyboat-summary'
import type { QuarterBarqoSummary, BarqoSummaryTotals } from '@/lib/finance/barqo-summary'
import type { QuarterRevolutSummary, RevolutSummaryTotals } from '@/lib/finance/revolut-summary'
import type { QuarterFareHarborPayoutSummary, FareHarborPayoutSummaryTotals } from '@/lib/finance/fareharbor-payout-summary'
import type { QuarterBtwDashboard, BtwDashboardTotals } from '@/lib/finance/btw-dashboard'

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

interface PartnersFinanceData {
  partners: PartnerRow[]
  totals: {
    outstandingPartnerOwesUsCents: number
    outstandingWeOwePartnerCents: number
  }
}

interface VatStripeData {
  quarters: QuarterVatSummary[]
  totals: VatSummaryTotals
}

interface ViatorData {
  quarters: QuarterViatorSummary[]
  totals: ViatorSummaryTotals
}

interface ViatorLineRow {
  id: string
  viatorReference: string
  arrivalDate: string | null
  saleDate: string | null
  grossAmount: number | null
  grossCurrency: string | null
  convertedAmountCents: number
  tourGradeTitle: string | null
}

interface ViatorBatchRow {
  id: string
  documentNumber: string | null
  adviceDate: string | null
  totalAmountCents: number | null
  revenueExCents: number | null
  revenueVatCents: number | null
  rawFilename: string | null
  hasAttachment: boolean
  lines: ViatorLineRow[]
}

interface GetYourGuidePaymentRow {
  id: string
  paymentNumber: string | null
  paymentRunDate: string | null
  invoiceNumber: string | null
  amountCents: number | null
  revenueExCents: number | null
  revenueVatCents: number | null
  hasAttachment: boolean
}

interface BoatLocalLineRow {
  id: string
  bookingDate: string | null
  guestName: string | null
  guestCount: number | null
  cruiseName: string | null
  totalCents: number
  exVatCents: number
  inclVatCents: number
}

interface BoatLocalBatchRow {
  id: string
  invoiceNumber: string | null
  issueDate: string | null
  periodStart: string | null
  periodEnd: string | null
  totalSalesInclVatCents: number | null
  commissionExVatCents: number | null
  vat21Cents: number | null
  totalWithheldCents: number | null
  operatorPayoutCents: number | null
  vat9InPayoutCents: number | null
  hasAttachment: boolean
  lines: BoatLocalLineRow[]
}

const ALL_TAB_KEYS = [
  'partners',
  'invoices',
  'btw-dashboard',
  'vat',
  'viator',
  'getyourguide',
  'boatlocal',
  'withlocals',
  'clickandboat',
  'getmyboat',
  'barqo',
  'revolut',
  'city-tax',
  'zettle',
  'fareharbor',
  'kasboek',
] as const
type TabKey = (typeof ALL_TAB_KEYS)[number]

interface ChannelStatusItem {
  key: TabKey
  sourceKey: string
  label: string
  allTimeRevenueCents: number
  hasPreviousMonthData: boolean
  isArchived: boolean
}

interface FinanceChannelStatusData {
  previousMonth: {
    key: string
    label: string
  }
  openInvoicesCount: number
  outstandingPartnersCount: number
  channels: ChannelStatusItem[]
}

const DEFAULT_CHANNELS: ChannelStatusItem[] = [
  { key: 'fareharbor', sourceKey: 'fareharbor', label: 'FareHarbor', allTimeRevenueCents: 1895734, hasPreviousMonthData: false, isArchived: true },
  { key: 'vat', sourceKey: 'stripe', label: 'Stripe (Website)', allTimeRevenueCents: 1865417, hasPreviousMonthData: true, isArchived: false },
  { key: 'zettle', sourceKey: 'zettle', label: 'Zettle', allTimeRevenueCents: 1225540, hasPreviousMonthData: true, isArchived: false },
  { key: 'withlocals', sourceKey: 'withlocals', label: 'Withlocals', allTimeRevenueCents: 1014488, hasPreviousMonthData: false, isArchived: false },
  { key: 'getyourguide', sourceKey: 'getyourguide', label: 'GetYourGuide', allTimeRevenueCents: 675590, hasPreviousMonthData: true, isArchived: false },
  { key: 'viator', sourceKey: 'viator', label: 'Viator', allTimeRevenueCents: 640088, hasPreviousMonthData: true, isArchived: false },
  { key: 'boatlocal', sourceKey: 'boatlocal', label: 'BoatLocal', allTimeRevenueCents: 435744, hasPreviousMonthData: true, isArchived: false },
  { key: 'revolut', sourceKey: 'revolut', label: 'Revolut', allTimeRevenueCents: 391952, hasPreviousMonthData: false, isArchived: false },
  { key: 'clickandboat', sourceKey: 'clickandboat', label: 'Click & Boat', allTimeRevenueCents: 258956, hasPreviousMonthData: false, isArchived: false },
  { key: 'getmyboat', sourceKey: 'getmyboat', label: 'GetMyBoat', allTimeRevenueCents: 104100, hasPreviousMonthData: false, isArchived: false },
  { key: 'barqo', sourceKey: 'barqo', label: 'Barqo', allTimeRevenueCents: 50366, hasPreviousMonthData: false, isArchived: false },
]

function formatShortEuro(cents: number): string {
  if (cents >= 100000) {
    const k = (cents / 100000).toFixed(1).replace('.', ',')
    return `€ ${k}k`
  }
  return `€ ${Math.round(cents / 100).toLocaleString('nl-NL')}`
}

export default function FinancePage() {
  const [tab, setTab] = useState<TabKey>('btw-dashboard')

  const { data: statusData } = useAdminFetch<FinanceChannelStatusData>(
    '/api/admin/finance/channel-status'
  )

  const openInvoicesCount = statusData?.openInvoicesCount ?? 0
  const outstandingPartnersCount = statusData?.outstandingPartnersCount ?? 0
  const previousMonthLabel = statusData?.previousMonth?.label ?? 'aug'

  const channels = statusData?.channels && statusData.channels.length > 0
    ? statusData.channels
    : DEFAULT_CHANNELS

  return (
    <div className="p-4 sm:p-8 max-w-none space-y-6">
      <FinanceSubnav />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-emerald-500" />
            Finance
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Partner settlements &amp; BTW / Stripe payout reconciliation
          </p>
        </div>
        <FinanceShareLinks />
      </div>

      {/* Redesigned Navigation */}
      <div className="space-y-4 bg-zinc-50/80 p-4 rounded-2xl border border-zinc-200/70 shadow-xs">
        {/* Tier 1: Core Overzichten & Beheer */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1">
            Overzichten &amp; Beheer
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab('btw-dashboard')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === 'btw-dashboard'
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'bg-white text-zinc-700 hover:bg-zinc-100/80 border border-zinc-200/80'
              }`}
            >
              <span>BTW dashboard</span>
              <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded ${tab === 'btw-dashboard' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-500'}`}>
                Totaal
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('invoices')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === 'invoices'
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'bg-white text-zinc-700 hover:bg-zinc-100/80 border border-zinc-200/80'
              }`}
            >
              <span>Open Facturen (Stripe)</span>
              {openInvoicesCount > 0 ? (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  tab === 'invoices'
                    ? 'bg-amber-400 text-amber-950 ring-2 ring-amber-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                }`}>
                  {openInvoicesCount} open
                </span>
              ) : (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${
                  tab === 'invoices'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  0 open ✓
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setTab('partners')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === 'partners'
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'bg-white text-zinc-700 hover:bg-zinc-100/80 border border-zinc-200/80'
              }`}
            >
              <span>Partners</span>
              {outstandingPartnersCount > 0 ? (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                  tab === 'partners'
                    ? 'bg-amber-400 text-amber-950'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}>
                  {outstandingPartnersCount} open
                </span>
              ) : (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium ${
                  tab === 'partners'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  Voldaan ✓
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setTab('city-tax')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === 'city-tax'
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'bg-white text-zinc-700 hover:bg-zinc-100/80 border border-zinc-200/80'
              }`}
            >
              <span>City Tax</span>
              <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded ${tab === 'city-tax' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-500'}`}>
                Gemeente
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('kasboek')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                tab === 'kasboek'
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'bg-white text-zinc-700 hover:bg-zinc-100/80 border border-zinc-200/80'
              }`}
            >
              <span>Kasboek bronnen</span>
              <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded ${tab === 'kasboek' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-500'}`}>
                Reconciliatie
              </span>
            </button>
          </div>
        </div>

        {/* Tier 2: Verkoopkanalen (Gerangschikt op All-Time Omzet) */}
        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Verkoopkanalen · gerangschikt op all-time omzet
            </span>
            <span className="text-[11px] text-zinc-400 font-normal lowercase">
              status recente maand ({previousMonthLabel})
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {channels.map((ch, idx) => {
              const isActive = tab === ch.key
              return (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => setTab(ch.key)}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                    isActive
                      ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm ring-1 ring-zinc-900'
                      : 'bg-white text-zinc-700 border-zinc-200/80 hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                    isActive ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-500'
                  }`}>
                    #{idx + 1}
                  </span>

                  <span className="font-semibold">{ch.label}</span>

                  <span className={`text-[11px] font-mono font-medium ${
                    isActive ? 'text-emerald-300' : 'text-zinc-500'
                  }`}>
                    {formatShortEuro(ch.allTimeRevenueCents)}
                  </span>

                  {/* Status chip */}
                  {ch.isArchived ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${
                      isActive ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-500'
                    }`}>
                      Archief
                    </span>
                  ) : ch.hasPreviousMonthData ? (
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {previousMonthLabel} ✓
                    </span>
                  ) : (
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isActive
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      {previousMonthLabel} ontbreekt
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {tab === 'partners' && <PartnersTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'btw-dashboard' && <BtwDashboardTab />}
      {tab === 'vat' && <VatStripeTab />}
      {tab === 'viator' && <ViatorTab />}
      {tab === 'getyourguide' && <GetYourGuideTab />}
      {tab === 'boatlocal' && <BoatLocalTab />}
      {tab === 'withlocals' && <WithlocalsTab />}
      {tab === 'clickandboat' && <ClickAndBoatTab />}
      {tab === 'getmyboat' && <GetMyBoatTab />}
      {tab === 'barqo' && <BarqoTab />}
      {tab === 'revolut' && <RevolutTab />}
      {tab === 'city-tax' && <CityTaxTab />}
      {tab === 'zettle' && <ZettleTab />}
      {tab === 'fareharbor' && <FareHarborPayoutTab />}
      {tab === 'kasboek' && <KasboekBronnenTab />}
    </div>
  )
}

// ── Shared: year switcher ────────────────────────────────────────────────
//
// Every per-quarter/per-maand table grows one row per period forever —
// after a year or two that's a lot of scrolling for a number Beer usually
// only needs "this year" for. Each period string (quarter "2026-Q2" or
// month "2026-06") starts with its year, so filtering is just a startsWith.
// Defaults to the newest year with data so a fresh page load shows the
// current year, not an arbitrary oldest-first list.

function yearsFromPeriods(periods: string[]): string[] {
  const years = new Set(periods.map(p => p.slice(0, 4)))
  return [...years].sort((a, b) => b.localeCompare(a))
}

function YearSwitcher({ years, year, onChange }: { years: string[]; year: string | null; onChange: (year: string) => void }) {
  if (years.length <= 1) return null
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 shrink-0">
      {years.map(y => (
        <button
          key={y}
          type="button"
          onClick={() => onChange(y)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            y === year ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          {y}
        </button>
      ))}
    </div>
  )
}

/** `useState` + the derive-effective-year dance every tab needs, in one hook. */
function useYearFilter(periods: string[]) {
  const years = yearsFromPeriods(periods)
  const [year, setYear] = useState<string | null>(null)
  const effectiveYear = year ?? years[0] ?? null
  return { years, year: effectiveYear, setYear }
}

/** Re-derives a totals card from whatever quarters/months are visible after
 *  year-filtering, rather than showing the server's all-time totals next to
 *  a table that's now scoped to one year — the two would otherwise disagree. */
function sumFields<T extends Record<string, number>>(rows: readonly unknown[], zero: T): T {
  const result = { ...zero }
  for (const row of rows as Array<Record<string, unknown>>) {
    for (const key of Object.keys(zero) as (keyof T)[]) {
      result[key] = ((result[key] as number) + (Number(row[key as string]) || 0)) as T[keyof T]
    }
  }
  return result
}

// ── Partners tab (existing behaviour, unchanged) ─────────────────────────────

function PartnersTab() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data, isLoading, error, refresh } =
    useAdminFetch<PartnersFinanceData>('/api/admin/finance/partners-summary')

  const partners = data?.partners ?? []
  const totals = data?.totals ?? { outstandingPartnerOwesUsCents: 0, outstandingWeOwePartnerCents: 0 }

  const sorted = [...partners].sort((a, b) => {
    const aOut = a.outstandingPartnerOwesUsCents + a.outstandingWeOwePartnerCents
    const bOut = b.outstandingPartnerOwesUsCents + b.outstandingWeOwePartnerCents
    return bOut - aOut
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      <AdminErrorBanner error={error} />

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
          <p className="text-xs text-zinc-400 mt-1">Commissions owed to partners (we collected)</p>
        </div>
      </div>

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading finance overview…
        </div>
      )}

      {!isLoading && partners.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          No partner activity yet.
        </div>
      )}

      {partners.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
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

// ── BTW dashboard tab (unified across all kasboek sources) ─────────────────

interface BtwDashboardData {
  quarters: QuarterBtwDashboard[]
  totals: BtwDashboardTotals
  months: QuarterBtwDashboard[]
}

const BTW_SOURCE_LABELS: Record<string, string> = {
  stripe: 'Stripe (website)',
  boatlocal: 'BoatLocal',
  zettle: 'Zettle',
  withlocals: 'Withlocals',
  clickandboat: 'Click & Boat',
  getyourguide: 'GetYourGuide',
  viator: 'Viator / TripAdvisor',
  getmyboat: 'GetMyBoat',
  barqo: 'Barqo',
  revolut: 'Revolut',
  fareharbor: 'FareHarbor',
}

/** One "Per kwartaal"/"Per maand" table with click-to-expand per-source
 *  breakdown — the same row shape works for either grain, only the period
 *  label formatter (quarterLabel vs monthLabel) differs. */
function BtwPeriodTable({
  title, rows, expanded, onToggle, formatLabel,
}: {
  title: string
  rows: QuarterBtwDashboard[]
  expanded: string | null
  onToggle: (period: string) => void
  formatLabel: (period: string) => string
}) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</p>
      <div className="rounded-lg border border-zinc-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">{title.startsWith('Per maand') ? 'Maand' : 'Kwartaal'}</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Laag verschuldigd (9%)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Hoog verschuldigd (21%)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Aftrekbaar (21%) *</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Indicatie netto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {rows.map(q => {
              const isOpen = expanded === q.quarter
              const sources = Object.entries(q.bySource).filter(
                ([, v]) => v.vat9OwedCents || v.vat21OwedCents || v.vat21DeductibleCents
              )
              return (
                <Fragment key={q.quarter}>
                  <tr
                    className="hover:bg-zinc-50 transition-colors cursor-pointer"
                    onClick={() => onToggle(q.quarter)}
                  >
                    <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                      {formatLabel(q.quarter)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat9OwedCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat21OwedCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-amber-700">−{fmtAdminAmount(q.vat21DeductibleCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.netIndicationCents)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-4 pt-0">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-zinc-400 uppercase tracking-wider">
                              <th className="text-left py-1.5 pr-3">Bron</th>
                              <th className="text-right py-1.5 pr-3">Laag (9%)</th>
                              <th className="text-right py-1.5 pr-3">Hoog (21%)</th>
                              <th className="text-right py-1.5 pr-3">Aftrekbaar *</th>
                              <th className="text-right py-1.5">Totaal</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-50">
                            {sources.map(([source, v]) => (
                              <tr key={source}>
                                <td className="py-1.5 pr-3 text-zinc-700">{BTW_SOURCE_LABELS[source] ?? source}</td>
                                <td className="py-1.5 pr-3 text-right text-zinc-900">{fmtAdminAmount(v.vat9OwedCents)}</td>
                                <td className="py-1.5 pr-3 text-right text-zinc-900">{fmtAdminAmount(v.vat21OwedCents)}</td>
                                <td className="py-1.5 pr-3 text-right text-amber-700">−{fmtAdminAmount(v.vat21DeductibleCents)}</td>
                                <td className="py-1.5 text-right font-semibold text-emerald-700">
                                  {fmtAdminAmount(v.vat9OwedCents + v.vat21OwedCents - v.vat21DeductibleCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BtwDashboardTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<BtwDashboardData>('/api/admin/finance/btw-dashboard/summary')

  const allQuarters = data?.quarters ?? []
  const allMonths = data?.months ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const months = year ? allMonths.filter(m => m.quarter.startsWith(year)) : allMonths
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          BTW uit alle kasboek-bronnen samen, per kwartaal en per maand — voor de aangifte. Klik een
          rij open voor de uitsplitsing per bron. &quot;Verschuldigd&quot; is BTW die je moet afdragen
          (omzet, 9% over het netto ontvangen/uitbetaalde bedrag voor Viator/GetYourGuide/Click &amp;
          Boat, 9% over de bruto tochtprijs voor Withlocals); &quot;aftrekbaar&quot; is BTW die
          BoatLocal/Withlocals over hun commissie in rekening brengen —{' '}
          <strong className="text-amber-700">nog te bevestigen met de boekhouder</strong>{' '}
          of dat voor Off Course daadwerkelijk aftrekbaar is.
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> BTW-dashboard laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen BTW-gegevens uit de bronnen.
        </div>
      )}

      <BtwPeriodTable
        title="Per kwartaal (voor de aangifte)"
        rows={quarters}
        expanded={expandedQuarter}
        onToggle={p => setExpandedQuarter(expandedQuarter === p ? null : p)}
        formatLabel={quarterLabel}
      />

      <BtwPeriodTable
        title="Per maand"
        rows={months}
        expanded={expandedMonth}
        onToggle={p => setExpandedMonth(expandedMonth === p ? null : p)}
        formatLabel={monthLabel}
      />
    </div>
  )
}

// ── BTW & Stripe tab ──────────────────────────────────────────────────────

function VatStripeTab() {
  const { data, isLoading, error, refresh } =
    useAdminFetch<VatStripeData>('/api/admin/finance/vat-stripe-summary')

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, {
        bookingCount: 0, grossCents: 0, vat9Cents: 0, vat21Cents: 0,
        totalVatCents: 0, stripeFeeCents: 0, netCents: 0, missingFeeCount: 0,
      })
    : undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Alleen boekingen die echt via Stripe zijn betaald (GetYourGuide, Viator, TripAdvisor en
          complimentary boekingen tellen niet mee — die hebben geen Stripe-transactie). Gegroepeerd
          per kwartaal op betaaldatum, niet op de vaardatum.
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Bruto (Stripe)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.grossCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Totaal BTW</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.totalVatCents)}</p>
            <p className="text-xs text-zinc-400 mt-1">
              {fmtAdminAmount(totals.vat9Cents)} @ 9% · {fmtAdminAmount(totals.vat21Cents)} @ 21%
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Stripe-kosten</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{fmtAdminAmount(totals.stripeFeeCents)}</p>
            {totals.missingFeeCount > 0 && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {totals.missingFeeCount} boeking{totals.missingFeeCount !== 1 ? 'en' : ''} nog onbekend
              </p>
            )}
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Netto (op de bank)</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.netCents)}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> BTW-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Stripe-betalingen gevonden.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Bruto</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 21%</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Totaal BTW</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Stripe-kosten</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(q.grossCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-500">{fmtAdminAmount(q.vat9Cents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-500">{fmtAdminAmount(q.vat21Cents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.totalVatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-amber-700">
                    {fmtAdminAmount(q.stripeFeeCents)}
                    {q.missingFeeCount > 0 && (
                      <span className="ml-1 text-amber-500" title={`${q.missingFeeCount} boeking(en) nog zonder bekende fee`}>*</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Viator tab ────────────────────────────────────────────────────────────

function ViatorTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<ViatorData>('/api/admin/finance/viator/summary')
  const { data: batchData, refresh: refreshBatches } =
    useAdminFetch<{ batches: ViatorBatchRow[] }>('/api/admin/finance/viator/batches')
  const { busy, message, isError, handleFileSelected } = useFinanceUpload(
    '/api/admin/finance/viator/upload',
    (data: { documentNumber: string; lineCount: number; newLinesStored: number }) => {
      const { documentNumber, lineCount, newLinesStored } = data
      refresh()
      refreshBatches()
      return `${documentNumber}: ${newLinesStored} van ${lineCount} boekingen opgeslagen${newLinesStored < lineCount ? ' (rest bestond al)' : ''}`
    },
  )
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, { batchCount: 0, bookingCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
    : undefined
  const allBatches = batchData?.batches ?? []
  const batches = year ? allBatches.filter(b => b.adviceDate?.startsWith(year)) : allBatches

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Betalingsoverzichten (&quot;Payment Advice&quot;) van Viator, geüpload als .xlsx-bijlage uit de
          maandelijkse mail van finance@viator.com. Gegroepeerd per kwartaal op de datum van de
          uitbetaling. 9% BTW over het netto overgemaakte bedrag (Viator vermeldt geen bruto
          klantprijs, dus dat bedrag is de BTW-basis — bevestigd door jou).
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Payment advice uploaden
          </Button>
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {message}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Ontvangen van Viator</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.totalAmountCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Boekingen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.bookingCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Payment advices</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.batchCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9% (verschuldigd)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.revenueVatCents)}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Viator-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen payment advice geüpload.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Payment advices</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ontvangen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.batchCount}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.totalAmountCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.revenueVatCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per payment advice — klik voor boekingen</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100">
            {batches.map(b => {
              const expanded = expandedBatchId === b.id
              return (
                <div key={b.id} className="bg-white">
                  <button
                    type="button"
                    onClick={() => setExpandedBatchId(expanded ? null : b.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-zinc-50 transition-colors"
                  >
                    {expanded ? <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />}
                    <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(b.adviceDate)}</span>
                    <span className="text-zinc-500 flex-1">{b.lines.length} boeking{b.lines.length !== 1 ? 'en' : ''}</span>
                    <span className="text-xs text-zinc-400 w-24 text-right shrink-0">BTW {fmtAdminAmount(b.revenueVatCents ?? 0)}</span>
                    <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(b.totalAmountCents)}</span>
                    {b.hasAttachment && (
                      <a
                        href={`/api/admin/finance/attachments/viator/${b.id}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 shrink-0"
                        title="Bekijk origineel .xlsx-bestand"
                      >
                        <FileDown className="w-3.5 h-3.5" /> bestand
                      </a>
                    )}
                  </button>
                  {expanded && (
                    <div className="px-4 pb-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-zinc-400 uppercase tracking-wider">
                            <th className="text-left py-1.5 pr-3">Referentie</th>
                            <th className="text-left py-1.5 pr-3">Aankomst</th>
                            <th className="text-left py-1.5 pr-3">Cruise</th>
                            <th className="text-right py-1.5 pr-3">Bruto</th>
                            <th className="text-right py-1.5">EUR</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {b.lines.map(l => (
                            <tr key={l.id}>
                              <td className="py-1.5 pr-3 text-zinc-500">{l.viatorReference}</td>
                              <td className="py-1.5 pr-3 text-zinc-500">{fmtAdminDate(l.arrivalDate)}</td>
                              <td className="py-1.5 pr-3 text-zinc-700">{l.tourGradeTitle ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-right text-zinc-500">
                                {l.grossAmount != null ? `${l.grossAmount} ${l.grossCurrency ?? ''}` : '—'}
                              </td>
                              <td className="py-1.5 text-right font-medium text-zinc-900">{fmtAdminAmount(l.convertedAmountCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── GetYourGuide tab ──────────────────────────────────────────────────────

interface GetYourGuideData {
  quarters: QuarterGetYourGuideSummary[]
  totals: GetYourGuideSummaryTotals
}

function GetYourGuideTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<GetYourGuideData>('/api/admin/finance/getyourguide/summary')
  const { data: paymentsData, refresh: refreshPayments } =
    useAdminFetch<{ payments: GetYourGuidePaymentRow[] }>('/api/admin/finance/getyourguide/payments')
  const { busy, message, isError, handleFileSelected } = useFinanceUpload(
    '/api/admin/finance/getyourguide/upload',
    (data: { paymentNumber: string; alreadyExisted: boolean }) => {
      const { paymentNumber, alreadyExisted } = data
      refresh()
      refreshPayments()
      return alreadyExisted ? `${paymentNumber}: bestond al, niks nieuws` : `${paymentNumber}: opgeslagen`
    },
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, { paymentCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
    : undefined
  const allPayments = paymentsData?.payments ?? []
  const payments = year ? allPayments.filter(p => p.paymentRunDate?.startsWith(year)) : allPayments

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Betalingsbevestigingen (&quot;Your payment is confirmed&quot;) van GetYourGuide, geüpload als
          .pdf-bijlage. Eén rij per uitbetaling — GetYourGuide splitst hier niet per boeking uit, in
          tegenstelling tot Viator. Gegroepeerd per kwartaal op de uitbetalingsdatum. 9% BTW over het
          netto overgemaakte bedrag (geen bruto klantprijs beschikbaar — bevestigd door jou).
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileSelected} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Payment PDF uploaden
          </Button>
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {message}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Ontvangen van GetYourGuide</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.totalAmountCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Uitbetalingen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.paymentCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9% (verschuldigd)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.revenueVatCents)}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> GetYourGuide-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen payment PDF geüpload.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Uitbetalingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ontvangen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.paymentCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.totalAmountCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.revenueVatCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payments.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per uitbetaling</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(p.paymentRunDate)}</span>
                <span className="text-zinc-500 flex-1 truncate">{p.invoiceNumber ?? p.paymentNumber}</span>
                <span className="text-xs text-zinc-400 w-24 text-right shrink-0">BTW {fmtAdminAmount(p.revenueVatCents ?? 0)}</span>
                <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(p.amountCents)}</span>
                {p.hasAttachment && (
                  <a
                    href={`/api/admin/finance/attachments/getyourguide/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 shrink-0"
                    title="Bekijk originele PDF"
                  >
                    <FileDown className="w-3.5 h-3.5" /> PDF
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── BoatLocal tab ─────────────────────────────────────────────────────────

interface BoatLocalData {
  quarters: QuarterBoatLocalSummary[]
  totals: BoatLocalSummaryTotals
}

function BoatLocalTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<BoatLocalData>('/api/admin/finance/boatlocal/summary')
  const { data: batchData, refresh: refreshBatches } =
    useAdminFetch<{ batches: BoatLocalBatchRow[] }>('/api/admin/finance/boatlocal/batches')
  const { busy, message, isError, handleFileSelected } = useFinanceUpload(
    '/api/admin/finance/boatlocal/upload',
    (data: { invoiceNumber: string; lineCount: number; newLinesStored: number }) => {
      const { invoiceNumber, lineCount, newLinesStored } = data
      refresh()
      refreshBatches()
      return `${invoiceNumber}: ${newLinesStored} van ${lineCount} boekingen opgeslagen${newLinesStored < lineCount ? ' (rest bestond al)' : ''}`
    },
  )
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, { batchCount: 0, bookingCount: 0, operatorPayoutCents: 0, vat9InPayoutCents: 0, vat21Cents: 0 })
    : undefined
  const allBatches = batchData?.batches ?? []
  const batches = year ? allBatches.filter(b => b.issueDate?.startsWith(year)) : allBatches

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Operator-facturen van BoatLocal (jouw andere project) — een echte betaling aan Off Course
          voor boekingen die via BoatLocal binnenkwamen, geen ander bedrijf. Geüpload als .pdf-bijlage.
          Deze factuur bevat wél een volledige BTW-uitsplitsing (9% over de omzet, 21% over BoatLocal&apos;s
          commissie). Gegroepeerd per kwartaal op de uitbetalingsdatum.
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileSelected} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Operator invoice uploaden
          </Button>
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {message}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Ontvangen van BoatLocal</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.operatorPayoutCents)}</p>
            <p className="text-xs text-zinc-400 mt-1">waarvan {fmtAdminAmount(totals.vat9InPayoutCents)} BTW (9%)</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Boekingen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.bookingCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Facturen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.batchCount}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> BoatLocal-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen operator invoice geüpload.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Facturen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW (9%)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ontvangen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.batchCount}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-500">{fmtAdminAmount(q.vat9InPayoutCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.operatorPayoutCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per factuur — klik voor boekingen</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100">
            {batches.map(b => {
              const expanded = expandedBatchId === b.id
              return (
                <div key={b.id} className="bg-white">
                  <button
                    type="button"
                    onClick={() => setExpandedBatchId(expanded ? null : b.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-zinc-50 transition-colors"
                  >
                    {expanded ? <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />}
                    <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(b.issueDate)}</span>
                    <span className="text-zinc-500 flex-1">{b.lines.length} boeking{b.lines.length !== 1 ? 'en' : ''}</span>
                    <span className="text-xs text-zinc-400 w-28 text-right shrink-0">BTW {fmtAdminAmount(b.vat9InPayoutCents)}</span>
                    <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(b.operatorPayoutCents)}</span>
                    {b.hasAttachment && (
                      <a
                        href={`/api/admin/finance/attachments/boatlocal/${b.id}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 shrink-0"
                        title="Bekijk originele PDF-factuur"
                      >
                        <FileDown className="w-3.5 h-3.5" /> PDF
                      </a>
                    )}
                  </button>
                  {expanded && (
                    <div className="px-4 pb-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-zinc-400 uppercase tracking-wider">
                            <th className="text-left py-1.5 pr-3">Datum</th>
                            <th className="text-left py-1.5 pr-3">Gast</th>
                            <th className="text-left py-1.5 pr-3">Cruise</th>
                            <th className="text-right py-1.5 pr-3">Ex BTW</th>
                            <th className="text-right py-1.5">Incl. BTW</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {b.lines.map(l => (
                            <tr key={l.id}>
                              <td className="py-1.5 pr-3 text-zinc-500">{fmtAdminDate(l.bookingDate)}</td>
                              <td className="py-1.5 pr-3 text-zinc-700">{l.guestName ?? '—'}{l.guestCount ? ` (${l.guestCount})` : ''}</td>
                              <td className="py-1.5 pr-3 text-zinc-700">{l.cruiseName ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-right text-zinc-500">{fmtAdminAmount(l.exVatCents)}</td>
                              <td className="py-1.5 text-right font-medium text-zinc-900">{fmtAdminAmount(l.inclVatCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Withlocals tab ────────────────────────────────────────────────────────

interface WithlocalsData {
  months: MonthWithlocalsSummary[]
  totals: WithlocalsSummaryTotals
}

interface WithlocalsBookingRow {
  id: string
  bookingId: string
  invoiceNumber: string | null
  invoiceDate: string | null
  tourName: string | null
  tripAt: string | null
  guestCount: number | null
  guestName: string | null
  tourPriceCents: number | null
  revenueExCents: number | null
  revenueVatCents: number | null
  netPayoutCents: number | null
  payoutDate: string | null
  hasAttachment: boolean
}

interface WithlocalsYearGroup {
  year: string
  months: MonthWithlocalsSummary[]
  subtotal: WithlocalsSummaryTotals
}

function groupWithlocalsByYear(months: MonthWithlocalsSummary[]): WithlocalsYearGroup[] {
  const byYear = new Map<string, MonthWithlocalsSummary[]>()
  for (const m of months) {
    const year = m.month.slice(0, 4)
    const arr = byYear.get(year) ?? []
    arr.push(m)
    byYear.set(year, arr)
  }
  return [...byYear.entries()]
    .sort((a, b) => (a[0] > b[0] ? -1 : 1))
    .map(([year, ms]) => ({
      year,
      months: ms,
      subtotal: ms.reduce<WithlocalsSummaryTotals>(
        (acc, m) => ({
          bookingCount: acc.bookingCount + m.bookingCount,
          revenueInclCents: acc.revenueInclCents + m.revenueInclCents,
          revenueExCents: acc.revenueExCents + m.revenueExCents,
          revenueVatCents: acc.revenueVatCents + m.revenueVatCents,
          commissionExCents: acc.commissionExCents + m.commissionExCents,
          commissionVatCents: acc.commissionVatCents + m.commissionVatCents,
          netPayoutCents: acc.netPayoutCents + m.netPayoutCents,
        }),
        { bookingCount: 0, revenueInclCents: 0, revenueExCents: 0, revenueVatCents: 0, commissionExCents: 0, commissionVatCents: 0, netPayoutCents: 0 }
      ),
    }))
}

interface WithlocalsQuarterRow {
  quarter: string
  totals: WithlocalsSummaryTotals
}

// BTW-aangifte in NL is filed per quarter, so this is the view that matters
// for that purpose — the per-month/per-tour table below stays for "which
// tours ran" detail, this one is for "what do I owe this quarter."
function groupWithlocalsByQuarter(months: MonthWithlocalsSummary[]): WithlocalsQuarterRow[] {
  const byQuarter = new Map<string, WithlocalsSummaryTotals>()
  for (const m of months) {
    const quarter = quarterFromDate(`${m.month}-01`)
    const acc = byQuarter.get(quarter) ?? { bookingCount: 0, revenueInclCents: 0, revenueExCents: 0, revenueVatCents: 0, commissionExCents: 0, commissionVatCents: 0, netPayoutCents: 0 }
    acc.bookingCount += m.bookingCount
    acc.revenueInclCents += m.revenueInclCents
    acc.revenueExCents += m.revenueExCents
    acc.revenueVatCents += m.revenueVatCents
    acc.commissionExCents += m.commissionExCents
    acc.commissionVatCents += m.commissionVatCents
    acc.netPayoutCents += m.netPayoutCents
    byQuarter.set(quarter, acc)
  }
  return [...byQuarter.entries()]
    .sort((a, b) => (a[0] > b[0] ? -1 : 1))
    .map(([quarter, totals]) => ({ quarter, totals }))
}

interface WithlocalsPayoutGroup {
  payoutDate: string | null
  bookings: WithlocalsBookingRow[]
  totalCents: number
}

// Groups by the actual bank payout date rather than trip month, so each
// group's total lines up 1:1 with a single line on the bank statement —
// the "Per maand" view groups by trip date, which almost never matches how
// Withlocals batches its payouts (see docs/features/kasboek-payout-pipelines.md).
function groupWithlocalsByPayout(bookings: WithlocalsBookingRow[]): WithlocalsPayoutGroup[] {
  const byPayout = new Map<string, WithlocalsBookingRow[]>()
  for (const b of bookings) {
    const key = b.payoutDate ?? '__pending__'
    const arr = byPayout.get(key) ?? []
    arr.push(b)
    byPayout.set(key, arr)
  }
  return [...byPayout.entries()]
    .sort(([a], [b]) => {
      if (a === '__pending__') return -1
      if (b === '__pending__') return 1
      return b.localeCompare(a)
    })
    .map(([payoutDate, rows]) => ({
      payoutDate: payoutDate === '__pending__' ? null : payoutDate,
      bookings: rows.sort((a, b) => (a.tripAt ?? '').localeCompare(b.tripAt ?? '')),
      totalCents: rows.reduce((sum, r) => sum + (r.netPayoutCents ?? 0), 0),
    }))
}

function WithlocalsTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<WithlocalsData>('/api/admin/finance/withlocals/summary')
  const { data: bookingsData, refresh: refreshBookings } =
    useAdminFetch<{ bookings: WithlocalsBookingRow[] }>('/api/admin/finance/withlocals/bookings')

  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [expandedPayout, setExpandedPayout] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const months = data?.months ?? []
  const { years, year, setYear } = useYearFilter(months.map(m => m.month))
  const yearGroups = groupWithlocalsByYear(months).filter(g => g.year === year)
  const quarterRows = groupWithlocalsByQuarter(months).filter(q => !year || q.quarter.startsWith(year))
  const bookings = bookingsData?.bookings ?? []
  const incompleteBookings = bookings.filter(b => !b.tripAt) // payout stub, invoice not ingested yet
  const payoutGroups = groupWithlocalsByPayout(bookings)

  function afterSave() {
    refresh()
    refreshBookings()
  }

  const {
    busy: invoiceBusy, message: invoiceMessage, isError: invoiceIsError, handleFileSelected: handleInvoiceFile,
  } = useFinanceUpload(
    '/api/admin/finance/withlocals/upload',
    (data: { bookingId: string; tourName: string | null; netPayoutCents: number; alreadyExisted: boolean }) => {
      const { bookingId, tourName, netPayoutCents, alreadyExisted } = data
      afterSave()
      return `${bookingId.slice(0, 8)} (${tourName ?? '—'}): netto ${fmtAdminAmount(netPayoutCents)}${alreadyExisted ? ' — bijgewerkt' : ' — nieuw'}`
    },
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Omzet via Withlocals (marktplaats). Twee mailtjes samen: het
          &quot;New invoice for booking&quot; PDF-tje (per boeking — tour, omzet, hun
          commissie + 21% BTW) en de maandelijkse &quot;New payout&quot;-mail (geen
          bijlage — koppelt boekingen aan de uitbetaling, wordt door de sync-skill
          op de achtergrond verwerkt). Gegroepeerd per vaarmaand, met 9% BTW over
          de bruto tochtprijs op de factuur (bevestigd door de boekhouder) en 21%
          BTW over Withlocals&apos; commissie —{' '}
          <strong className="text-amber-700">nog te bevestigen met de boekhouder</strong>{' '}
          of dat laatste bedrag aftrekbaar is als voorbelasting.
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={afterSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Invoice upload */}
      <div className="flex items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleInvoiceFile} />
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={invoiceBusy}>
          {invoiceBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Invoice PDF uploaden
        </Button>
      </div>
      {invoiceMessage && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          invoiceIsError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {invoiceMessage}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {incompleteBookings.length > 0 && (
        <div className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {incompleteBookings.length} boeking{incompleteBookings.length !== 1 ? 'en' : ''} wel uitbetaald maar nog
            geen factuur ontvangen: {incompleteBookings.map(b => b.bookingId.slice(0, 8)).join(', ')} — upload de
            bijbehorende invoice PDF om de tour/BTW-detail aan te vullen.
          </span>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Withlocals-overzicht laden…
        </div>
      )}

      {!isLoading && months.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Withlocals-boekingen ingevoerd.
        </div>
      )}

      {quarterRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per kwartaal (voor de BTW-aangifte)</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Omzet (incl.)</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9% (omzet)</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 21% (commissie) *</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto uitbetaald</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {quarterRows.map(q => (
                  <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                    <td className="px-4 py-3 text-right text-zinc-500">{q.totals.bookingCount}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(q.totals.revenueInclCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.totals.revenueVatCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.totals.commissionVatCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.totals.netPayoutCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {months.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per maand — welke tours</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Maand</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Omzet (incl.)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9% (omzet)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider" title="Nog te bevestigen met de boekhouder of dit aftrekbaar is">
                  BTW 21% (commissie) *
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto uitbetaald</th>
              </tr>
            </thead>
            {yearGroups.map(group => (
              <tbody key={group.year} className="divide-y divide-zinc-100 bg-white border-b-2 border-zinc-200">
                {group.months.map(m => {
                  const expanded = expandedMonth === m.month
                  return (
                    <Fragment key={m.month}>
                      <tr
                        key={m.month}
                        className="hover:bg-zinc-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedMonth(expanded ? null : m.month)}
                      >
                        <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap flex items-center gap-2">
                          {expanded ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                          {monthLabel(`${m.month}-01`)}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-500">{m.bookingCount}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(m.revenueInclCents)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(m.revenueVatCents)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(m.commissionVatCents)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(m.netPayoutCents)}</td>
                      </tr>
                      {expanded && (
                        <tr key={`${m.month}-detail`}>
                          <td colSpan={6} className="px-4 pb-4 pt-0">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-zinc-400 uppercase tracking-wider">
                                  <th className="text-left py-1.5 pr-3">Tour / boeking</th>
                                  <th className="text-right py-1.5 pr-3">Datum · factuur</th>
                                  <th className="text-right py-1.5 pr-3">Omzet (incl.)</th>
                                  <th className="text-right py-1.5">BTW 9%</th>
                                </tr>
                              </thead>
                              {m.tours.map(t => {
                                // Individual bookings behind this tour's subtotal — same
                                // month + tour name, so the subtotal can be traced back
                                // to the exact invoice numbers/dates that add up to it.
                                const tourBookings = bookings
                                  .filter(b => (b.tripAt?.slice(0, 7) === m.month) && (b.tourName ?? 'Onbekende tour') === t.tourName)
                                  .sort((a, b) => (a.tripAt ?? '').localeCompare(b.tripAt ?? ''))
                                return (
                                  <tbody key={t.tourName} className="divide-y divide-zinc-50">
                                    <tr className="font-semibold">
                                      <td className="py-1.5 pr-3 text-zinc-700">{t.tourName}</td>
                                      <td className="py-1.5 pr-3 text-right text-zinc-500">{t.bookingCount} boeking{t.bookingCount !== 1 ? 'en' : ''}</td>
                                      <td className="py-1.5 pr-3 text-right text-zinc-900">{fmtAdminAmount(t.revenueInclCents)}</td>
                                      <td className="py-1.5 text-right text-zinc-500">{fmtAdminAmount(t.revenueVatCents)}</td>
                                    </tr>
                                    {tourBookings.map(b => (
                                      <tr key={b.id} className="text-zinc-400">
                                        <td className="py-1 pr-3 pl-4">{b.guestName ?? '—'}</td>
                                        <td className="py-1 pr-3 text-right whitespace-nowrap">
                                          {dayLabel(b.tripAt)} · {b.invoiceNumber ?? 'geen factuur'}
                                        </td>
                                        <td className="py-1 pr-3 text-right">{fmtAdminAmount(b.tourPriceCents ?? 0)}</td>
                                        <td className="py-1 text-right">{fmtAdminAmount(b.revenueVatCents ?? 0)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                )
                              })}
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                <tr className="bg-zinc-50 font-semibold text-zinc-900">
                  <td className="px-4 py-3 whitespace-nowrap">Totaal {group.year}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{group.subtotal.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.revenueInclCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.revenueVatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.commissionVatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-emerald-700">{fmtAdminAmount(group.subtotal.netPayoutCents)}</td>
                </tr>
              </tbody>
            ))}
          </table>
          </div>
        </div>
      )}

      {payoutGroups.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Per uitbetaling — voor reconciliatie met de bank
          </p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Uitbetaald op</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto totaal (= bankregel)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {payoutGroups.map(g => {
                  const key = g.payoutDate ?? 'pending'
                  const expanded = expandedPayout === key
                  return (
                    <Fragment key={key}>
                      <tr
                        className="hover:bg-zinc-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedPayout(expanded ? null : key)}
                      >
                        <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap flex items-center gap-2">
                          {expanded ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                          {g.payoutDate ? fmtAdminDate(g.payoutDate) : (
                            <span className="text-amber-700">Nog niet uitbetaald</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-500">{g.bookings.length}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">
                          {fmtAdminAmount(g.totalCents)}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={3} className="px-4 pb-4 pt-0">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-zinc-400 uppercase tracking-wider">
                                  <th className="text-left py-1.5 pr-3">Gast</th>
                                  <th className="text-left py-1.5 pr-3">Tour</th>
                                  <th className="text-right py-1.5 pr-3">Vaardatum</th>
                                  <th className="text-right py-1.5 pr-3">Factuur</th>
                                  <th className="text-right py-1.5">Netto</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-50">
                                {g.bookings.map(b => (
                                  <tr key={b.id}>
                                    <td className="py-1 pr-3 text-zinc-700">{b.guestName ?? `#${b.bookingId.slice(0, 8)}`}</td>
                                    <td className="py-1 pr-3 text-zinc-500 truncate max-w-[16rem]">{b.tourName ?? '—'}</td>
                                    <td className="py-1 pr-3 text-right whitespace-nowrap text-zinc-500">{dayLabel(b.tripAt)}</td>
                                    <td className="py-1 pr-3 text-right whitespace-nowrap text-zinc-400">{b.invoiceNumber ?? '—'}</td>
                                    <td className="py-1 text-right whitespace-nowrap text-zinc-900">{fmtAdminAmount(b.netPayoutCents ?? 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bookings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per boeking</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {bookings.map(b => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(b.tripAt ?? b.payoutDate)}</span>
                <span className="text-zinc-500 flex-1 truncate">{b.tourName ?? `#${b.bookingId.slice(0, 8)} (nog geen factuur)`}</span>
                <span className="text-zinc-400 w-16 shrink-0">{b.guestCount ? `${b.guestCount} pers.` : ''}</span>
                <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(b.netPayoutCents)}</span>
                {b.hasAttachment && (
                  <a
                    href={`/api/admin/finance/attachments/withlocals/${b.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 shrink-0"
                    title="Bekijk originele PDF"
                  >
                    <FileDown className="w-3.5 h-3.5" /> PDF
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Click & Boat tab ──────────────────────────────────────────────────────

interface ClickAndBoatData {
  quarters: QuarterClickAndBoatSummary[]
  totals: ClickAndBoatSummaryTotals
}

interface ClickAndBoatBookingRow {
  id: string
  charterNumber: string
  listingTitle: string | null
  charterStartDate: string | null
  charterEndDate: string | null
  durationDays: number | null
  grossAmountCents: number | null
  netAmountCents: number | null
  revenueExCents: number | null
  revenueVatCents: number | null
  bankTransferDate: string | null
  location: string | null
}

function ClickAndBoatTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<ClickAndBoatData>('/api/admin/finance/clickandboat/summary')
  const { data: bookingsData, refresh: refreshBookings } =
    useAdminFetch<{ bookings: ClickAndBoatBookingRow[] }>('/api/admin/finance/clickandboat/bookings')
  const { busy, message, isError, handleFileSelected } = useFinanceUpload(
    '/api/admin/finance/clickandboat/upload',
    (data: { rowCount: number; storedCount: number }) => {
      const { rowCount, storedCount } = data
      refresh()
      refreshBookings()
      return `${storedCount} van ${rowCount} boekingen opgeslagen/bijgewerkt`
    },
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, { bookingCount: 0, grossAmountCents: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
    : undefined
  const allBookings = bookingsData?.bookings ?? []
  const bookings = year ? allBookings.filter(b => b.charterStartDate?.startsWith(year)) : allBookings

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Omzet via Click &amp; Boat (Frans platform, betaalt per boeking direct
          na de tocht uit — geen maandbatch). Kom binnen via de &quot;Download the
          summary&quot;-CSV op clickandboat.com/en/account/bookings (dekt altijd de
          volledige historie, dus veilig om steeds opnieuw te uploaden). 9% BTW
          over het <strong>netto ontvangen bedrag</strong>{' '}
          (niet over de bruto huurprijs incl. verzekering die de huurder
          betaalde) — bevestigd door jou, een ander uitgangspunt dan Withlocals.
          Elke boeking heeft ook een losse Click&amp;Boat-commissiefactuur
          (BTW verlegd, Frans bedrijf) — nog niet los verwerkt, puur
          documentatie.
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelected} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Revenue CSV uploaden
          </Button>
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {message}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Netto ontvangen</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.netAmountCents)}</p>
            <p className="text-xs text-zinc-400 mt-1">bruto (huurder incl. verzekering): {fmtAdminAmount(totals.grossAmountCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Boekingen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.bookingCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9% (verschuldigd)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.revenueVatCents)}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Click&amp;Boat-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Click&amp;Boat-boekingen geüpload.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Bruto (ref.)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto ontvangen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-500">{fmtAdminAmount(q.grossAmountCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.netAmountCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.revenueVatCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per boeking</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {bookings.map(b => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(b.charterStartDate)}</span>
                <span className="text-zinc-500 flex-1 truncate">
                  {b.listingTitle ?? '—'} · #{b.charterNumber}
                </span>
                <span className="text-xs text-zinc-400 w-24 text-right shrink-0">BTW {fmtAdminAmount(b.revenueVatCents ?? 0)}</span>
                <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(b.netAmountCents ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── GetMyBoat tab ─────────────────────────────────────────────────────────
//
// No upload button here — Getmyboat's payout is a plain email with no
// attachment (like Withlocals' payout side), and there's deliberately no
// manual paste UI for it: the sync-skill agent posts the email text
// directly to /api/admin/finance/getmyboat/payout in the background. This
// tab only ever displays what's already stored.

interface GetMyBoatData {
  quarters: QuarterGetMyBoatSummary[]
  totals: GetMyBoatSummaryTotals
}

interface GetMyBoatBookingRow {
  id: string
  bookingId: string
  guestName: string | null
  charterDate: string | null
  netAmountCents: number | null
  revenueExCents: number | null
  revenueVatCents: number | null
  payoutDate: string | null
}

function GetMyBoatTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<GetMyBoatData>('/api/admin/finance/getmyboat/summary')
  const { data: bookingsData, refresh: refreshBookings } =
    useAdminFetch<{ bookings: GetMyBoatBookingRow[] }>('/api/admin/finance/getmyboat/bookings')

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, { bookingCount: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 })
    : undefined
  const allBookings = bookingsData?.bookings ?? []
  const bookings = year ? allBookings.filter(b => b.charterDate?.startsWith(year)) : allBookings

  function afterSave() {
    refresh()
    refreshBookings()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Omzet via Getmyboat (Amerikaans platform). Komt binnen via de &quot;Getmyboat has sent you
          money&quot;-mail (geen bijlage, tekst in de mail, meerdere boekingen per uitbetaling) —
          wordt door de sync-skill op de achtergrond verwerkt, geen los uploadknopje hier. Elke
          boeking heeft hetzelfde numerieke boekingsnummer in zowel de payout-mail als de losse
          &quot;Booking Confirmed!&quot;-mail, dus exacte match, geen fuzzy prefix zoals bij
          Withlocals. 9% BTW over het <strong>netto uitbetaalde bedrag</strong> (niet over de
          bruto &quot;Base Cost&quot; uit de bevestigingsmail) — bevestigd door jou, zelfde
          uitgangspunt als Click &amp; Boat/GetYourGuide/Viator.
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={afterSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Netto ontvangen</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.netAmountCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Boekingen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.bookingCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9% (verschuldigd)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.revenueVatCents)}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Getmyboat-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Getmyboat-boekingen verwerkt.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto ontvangen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.netAmountCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.revenueVatCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per boeking</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {bookings.map(b => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(b.charterDate)}</span>
                <span className="text-zinc-500 flex-1 truncate">
                  {b.guestName ?? '—'} · #{b.bookingId}
                </span>
                <span className="text-xs text-zinc-400 w-24 text-right shrink-0">BTW {fmtAdminAmount(b.revenueVatCents ?? 0)}</span>
                <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(b.netAmountCents ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Barqo tab ─────────────────────────────────────────────────────────────
//
// No upload button, no payout email to paste either — Barqo has no
// recurring document of any kind. The dashboard at
// barqo.co/dashboard/booking-overview is the only source, read by hand/agent
// and saved via a plain upsert, same "no document" pattern as Zettle.

interface BarqoData {
  quarters: QuarterBarqoSummary[]
  totals: BarqoSummaryTotals
}

interface BarqoBookingRow {
  id: string
  bookingNumber: string
  guestName: string | null
  boatName: string | null
  tripDate: string | null
  priceCents: number | null
  netPayoutCents: number | null
  revenueExCents: number | null
  revenueVatCents: number | null
  commissionExCents: number | null
  commissionVatCents: number | null
}

function BarqoTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<BarqoData>('/api/admin/finance/barqo/summary')
  const { data: bookingsData, refresh: refreshBookings } =
    useAdminFetch<{ bookings: BarqoBookingRow[] }>('/api/admin/finance/barqo/bookings')

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, {
        bookingCount: 0, priceCents: 0, netPayoutCents: 0,
        revenueExCents: 0, revenueVatCents: 0, commissionExCents: 0, commissionVatCents: 0,
      })
    : undefined
  const allBookings = bookingsData?.bookings ?? []
  const bookings = year ? allBookings.filter(b => b.tripDate?.startsWith(year)) : allBookings

  function afterSave() {
    refresh()
    refreshBookings()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Omzet via Barqo (barqo.nl, verhuurplatform waar boot Diana op staat). Boekingsaanvragen
          komen binnen op bookings@boatlocal.nl, niet bij Off Course zelf — makkelijk te missen.
          Geen terugkerende betaalmail of CSV-export — het dashboard op
          barqo.co/dashboard/booking-overview toont alleen de bruto prijs; de netto uitbetaling
          (bruto minus Barqo&apos;s eigen commissie, incl. 21% BTW — zelfde opzet als BoatLocal)
          komt pas boven water via de bank. 9% BTW is over de netto uitbetaling, niet de bruto
          prijs — of het 21%-commissiebedrag aftrekbaar is als voorbelasting is{' '}
          <strong className="text-amber-700">nog te bevestigen met de boekhouder</strong>, net als
          bij BoatLocal/Withlocals. Zeer laag volume (2 boekingen ooit, beide van vóór onze eigen
          Stripe-koppeling in maart 2026).
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={afterSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Omzet (bruto)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.priceCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Netto uitbetaald</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.netPayoutCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Boekingen</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{totals.bookingCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9% (verschuldigd)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.revenueVatCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 21% (commissie) *</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{fmtAdminAmount(totals.commissionVatCents)}</p>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Barqo-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Barqo-boekingen ingevoerd.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Boekingen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Omzet (bruto)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9% (netto)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 21% (commissie) *</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto uitbetaald</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.bookingCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(q.priceCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.revenueVatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.commissionVatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.netPayoutCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per boeking</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {bookings.map(b => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900 w-28 shrink-0">{fmtAdminDate(b.tripDate)}</span>
                <span className="text-zinc-500 flex-1 truncate">
                  {b.guestName ?? '—'} · {b.boatName ?? '—'} · #{b.bookingNumber}
                  {b.netPayoutCents == null && (
                    <span className="ml-2 text-xs text-amber-700">(netto nog niet bevestigd)</span>
                  )}
                </span>
                <span className="text-xs text-zinc-400 w-32 text-right shrink-0">
                  BTW 9% {fmtAdminAmount(b.revenueVatCents ?? 0)} · 21% {fmtAdminAmount(b.commissionVatCents ?? 0)}
                </span>
                <span className="text-xs text-zinc-400 w-20 text-right shrink-0">{fmtAdminAmount(b.priceCents ?? 0)}</span>
                <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(b.netPayoutCents ?? b.priceCents ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Revolut tab ───────────────────────────────────────────────────────────

interface RevolutData {
  quarters: QuarterRevolutSummary[]
  totals: RevolutSummaryTotals
}

interface RevolutTransactionRow {
  id: string
  transactionId: string
  occurredAt: string | null
  payoutDate: string | null
  description: string | null
  customerName: string | null
  originalAmountCents: number | null
  settlementAmountCents: number | null
  processingFeeCents: number | null
  vat9GrossCents: number | null
  vat21GrossCents: number | null
  isClassified: boolean
  suggestedVat9GrossCents: number | null
  suggestedVat21GrossCents: number | null
}

// cents -> "12.34" for a euro <input>; cents may be null/0 for an unset field
function centsToEuroInput(cents: number | null | undefined): string {
  return (((cents ?? 0)) / 100).toFixed(2)
}

function euroInputToCents(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** One transaction's classify row — local edit state, submits to /classify. */
function RevolutClassifyRow({ t, onClassified }: { t: RevolutTransactionRow; onClassified: () => void }) {
  const [vat9, setVat9] = useState(centsToEuroInput(t.vat9GrossCents ?? t.suggestedVat9GrossCents))
  const [vat21, setVat21] = useState(centsToEuroInput(t.vat21GrossCents ?? t.suggestedVat21GrossCents))
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(!t.isClassified)

  const vat9Cents = euroInputToCents(vat9)
  const vat21Cents = euroInputToCents(vat21)
  const splitTotal = vat9Cents + vat21Cents
  const mismatch = editing && splitTotal !== (t.originalAmountCents ?? 0)

  async function confirm() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/finance/revolut/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, vat9GrossCents: vat9Cents, vat21GrossCents: vat21Cents }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setEditing(false)
      onClassified()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center">
      <span className="font-medium text-zinc-900 w-28 shrink-0">
        {t.payoutDate ? fmtAdminDate(t.payoutDate) : <span className="text-amber-700">nog niet uitbetaald</span>}
      </span>
      <span className="text-zinc-500 flex-1 truncate" title={t.description ?? undefined}>
        {t.description ?? '—'} {t.customerName ? `· ${t.customerName}` : ''}
        <span className="text-zinc-400"> · betaald {fmtAdminDate(t.occurredAt)}</span>
      </span>
      <span className="text-xs text-zinc-400 w-20 text-right shrink-0">{fmtAdminAmount(t.originalAmountCents ?? 0)}</span>

      {editing ? (
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1 text-xs text-zinc-500">
            9%
            <input
              type="number" step="0.01" value={vat9} onChange={e => setVat9(e.target.value)}
              className="w-20 rounded border border-zinc-200 px-1.5 py-1 text-right text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-zinc-500">
            21%
            <input
              type="number" step="0.01" value={vat21} onChange={e => setVat21(e.target.value)}
              className="w-20 rounded border border-zinc-200 px-1.5 py-1 text-right text-xs"
            />
          </label>
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Bevestigen'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-zinc-400">9% {fmtAdminAmount(t.vat9GrossCents ?? 0)} · 21% {fmtAdminAmount(t.vat21GrossCents ?? 0)}</span>
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-zinc-400 hover:text-zinc-700">
            bewerk
          </button>
        </div>
      )}
      {mismatch && (
        <p className="text-xs text-amber-700 sm:ml-28">
          9% + 21% ({fmtAdminAmount(splitTotal)}) komt niet overeen met het bedrag ({fmtAdminAmount(t.originalAmountCents ?? 0)})
        </p>
      )}
    </div>
  )
}

function RevolutTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<RevolutData>('/api/admin/finance/revolut/summary')
  const { data: txData, refresh: refreshTx } =
    useAdminFetch<{ transactions: RevolutTransactionRow[] }>('/api/admin/finance/revolut/transactions')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, {
        transactionCount: 0, originalAmountCents: 0, vat9GrossCents: 0, vat9VatCents: 0,
        vat21GrossCents: 0, vat21VatCents: 0, unclassifiedCount: 0, unclassifiedAmountCents: 0,
      })
    : undefined
  const unpaidCount = data?.totals.unpaidCount ?? 0
  const unpaidAmountCents = data?.totals.unpaidAmountCents ?? 0
  const allTransactions = txData?.transactions ?? []
  const unpaidTransactions = allTransactions.filter(t => !t.payoutDate)
  const paidTransactions = year
    ? allTransactions.filter(t => t.payoutDate?.startsWith(year))
    : allTransactions.filter(t => t.payoutDate)

  function afterClassify() {
    refresh()
    refreshTx()
  }

  const { busy, message, isError, handleFileSelected } = useFinanceUpload(
    '/api/admin/finance/revolut/upload',
    (data: { rowCount: number; storedCount: number }) => {
      const { rowCount, storedCount } = data
      afterClassify()
      return `${storedCount} van ${rowCount} transacties opgeslagen/bijgewerkt`
    },
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Omzet via Revolut (betaallinkjes, Rederij Zoomers &amp; Schenk EUR Merchant) — losse
          boekingen/drankjes/merch die niet via de site-checkout lopen. Upload de &quot;Merchant
          reconciliation statement&quot; CSV uit het Revolut Business dashboard. Elke transactie
          heeft geen vaste BTW-regel — een bedrag kan deels 9% (tocht) en deels 21%
          (drankjes/merch) zijn, en de omschrijving alleen is niet altijd betrouwbaar genoeg om
          dat automatisch te bepalen. Daarom moet je (of de sync-skill) elke transactie hieronder
          een keer bevestigen. Belangrijk voor de boekhouder: er wordt gegroepeerd op de datum
          waarop Revolut het geld écht naar de bank overmaakte (herleid uit Revolut&apos;s eigen
          uitbetalings-historie in de CSV), niet op de datum dat de klant betaalde — die twee
          liggen vaak dagen tot maanden uit elkaar.
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelected} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Statement CSV uploaden
          </Button>
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={afterClassify} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {message}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Omzet (bruto)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.originalAmountCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9% (tocht)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.vat9VatCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 21% (drankjes/merch)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.vat21VatCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Nog te classificeren</p>
            <p className={`text-2xl font-bold mt-1 ${totals.unclassifiedCount > 0 ? 'text-amber-700' : 'text-zinc-900'}`}>
              {totals.unclassifiedCount}
            </p>
          </div>
        </div>
      )}

      {unpaidCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>{unpaidCount} transactie{unpaidCount === 1 ? '' : 's'} nog niet uitbetaald</strong>{' '}
          ({fmtAdminAmount(unpaidAmountCents)}) — zit nog in de Revolut-balans, wacht op de
          volgende overschrijving naar de bank. Telt nergens in de kwartaaltotalen of het
          BTW-dashboard mee totdat uitbetaald.
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Revolut-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Revolut-transacties geüpload.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Transacties</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Omzet (bruto)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 21%</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Nog te classificeren</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.transactionCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(q.originalAmountCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat9VatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat21VatCents)}</td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap ${q.unclassifiedCount > 0 ? 'text-amber-700 font-semibold' : 'text-zinc-400'}`}>
                    {q.unclassifiedCount || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unpaidTransactions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Nog niet uitbetaald</p>
          <div className="rounded-lg border border-amber-200 overflow-x-auto divide-y divide-amber-100 bg-white">
            {unpaidTransactions.map(t => (
              <RevolutClassifyRow key={t.id} t={t} onClassified={afterClassify} />
            ))}
          </div>
        </div>
      )}

      {paidTransactions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per transactie (uitbetaald)</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {paidTransactions.map(t => (
              <RevolutClassifyRow key={t.id} t={t} onClassified={afterClassify} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── City Tax tab ──────────────────────────────────────────────────────────
//
// Amsterdam's day-trip city tax: €2.60/guest, first 250 guests/year exempt
// fleet-wide. Already charged to every customer at checkout — this tab just
// adds it up for remittance. Deliberately shows what's EXCLUDED alongside
// the total, since the underlying `bookings` data has real, known gaps (see
// src/lib/finance/city-tax.ts) — a single confident-looking number here
// would be worse than no tab at all.

interface CityTaxData {
  year: number
  countedGuests: number
  countedBookings: number
  freeGuests: number
  billableGuests: number
  cityTaxOwedCents: number
  excludedNoGuestCount: number
  excludedNotActive: number
  duplicatesResolved: number
  untrackedSources: readonly string[]
}

const CITY_TAX_SOURCE_LABELS: Record<string, string> = {
  withlocals: 'Withlocals',
  clickandboat: 'Click & Boat',
  getmyboat: 'GetMyBoat',
  barqo: 'Barqo',
}

function CityTaxTab() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const { data, isLoading, error, refresh } = useAdminFetch<CityTaxData>(
    `/api/admin/finance/city-tax/summary?year=${year}`
  )
  const yearOptions = [2026, 2027, 2028].filter(y => y <= year + 1 || y === 2026)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Amsterdam toeristenbelasting voor dagtochten: €2,60 per gast, de eerste 250 gasten per
          kalenderjaar zijn vrijgesteld — over de hele vloot samen, niet per boot. Dit bedrag zit
          al in elke boeking verwerkt bij checkout; dit tabblad telt het alleen op voor de
          gemeente-aangifte. Geteld vanaf boekjaar 2026.
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="text-sm border border-zinc-200 rounded-md px-2 py-1.5 bg-white"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> City tax laden…
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Geteld ({data.year})</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{data.countedGuests} gasten</p>
              <p className="text-xs text-zinc-400 mt-1">{data.countedBookings} boekingen</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Vrijstelling</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{data.freeGuests} gasten</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Belastbaar</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{data.billableGuests} gasten</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Verschuldigd</p>
              <p className="text-2xl font-bold text-emerald-800 mt-1">{fmtAdminAmount(data.cityTaxOwedCents)}</p>
            </div>
          </div>

          {(data.excludedNoGuestCount > 0 || data.excludedNotActive > 0 || data.duplicatesResolved > 0 || data.untrackedSources.length > 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 space-y-1.5">
                <p className="font-semibold">Dit is een ondergrens, geen volledige telling</p>
                {data.excludedNoGuestCount > 0 && (
                  <p>{data.excludedNoGuestCount} actieve boeking{data.excludedNoGuestCount !== 1 ? 'en' : ''} zonder bekend aantal gasten — niet meegeteld (nooit gegokt).</p>
                )}
                {data.excludedNotActive > 0 && (
                  <p>{data.excludedNotActive} boeking{data.excludedNotActive !== 1 ? 'en' : ''} geannuleerd/herboekt/nog niet betaald — terecht overgeslagen.</p>
                )}
                {data.duplicatesResolved > 0 && (
                  <p>{data.duplicatesResolved} dubbele rij{data.duplicatesResolved !== 1 ? 'en' : ''} (twee systemen schreven dezelfde boeking) — maar één keer geteld.</p>
                )}
                {data.untrackedSources.length > 0 && (
                  <p>
                    Boekingen via {data.untrackedSources.map(s => CITY_TAX_SOURCE_LABELS[s] ?? s).join(', ')} staan
                    helemaal niet in deze telling — die worden rechtstreeks in FareHarbor ingevoerd,
                    los van dit systeem. Check hun eigen tabblad hierboven voor het boekingsaantal
                    daar.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Zettle tab ────────────────────────────────────────────────────────────

interface ZettleData {
  quarters: QuarterZettleSummary[]
  totals: ZettleSummaryTotals
}

interface ZettleMonthRow {
  id: string
  month: string
  totalInclVatCents: number | null
  totalExclVatCents: number | null
  saleCount: number | null
  vat9VatCents: number | null
  vat21VatCents: number | null
  totalVatCents: number | null
  cardGrossCents: number | null
  cardSurchargeCents: number | null
  cardNetCents: number | null
  cashZettleCents: number | null
  cashCountedCents: number | null
}

const MONTH_NAMES_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

// "2025-06-01" → "jun 2025" (parsed off the string, no timezone surprises)
function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month)
  if (!m) return month
  return `${MONTH_NAMES_NL[Number(m[2]) - 1]} ${m[1]}`
}

// "2026-06-21T15:00:00+02:00" → "21 jun" (day-level, for per-booking rows)
function dayLabel(date: string | null): string {
  if (!date) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return date
  return `${Number(m[3])} ${MONTH_NAMES_NL[Number(m[2]) - 1]}`
}

interface ZettleYearGroup {
  year: string
  quarters: QuarterZettleSummary[]
  subtotal: {
    totalInclVatCents: number
    vat9VatCents: number
    vat21VatCents: number
    cardSurchargeCents: number
    cardNetCents: number
    cashZettleCents: number
    cashDiffCents: number
    cashUncountedMonths: number
  }
}

// Group the quarter rows by calendar year (newest first) with a per-year
// subtotal. A single all-time total across years isn't meaningful for the
// kasboek — BTW is filed per year — so the useful accountant view is per-year.
function groupQuartersByYear(quarters: QuarterZettleSummary[]): ZettleYearGroup[] {
  const byYear = new Map<string, QuarterZettleSummary[]>()
  for (const q of quarters) {
    const year = q.quarter.slice(0, 4)
    const arr = byYear.get(year) ?? []
    arr.push(q)
    byYear.set(year, arr)
  }
  return [...byYear.entries()]
    .sort((a, b) => (a[0] > b[0] ? -1 : 1))
    .map(([year, qs]) => ({
      year,
      quarters: qs,
      subtotal: qs.reduce(
        (acc, q) => ({
          totalInclVatCents: acc.totalInclVatCents + q.totalInclVatCents,
          vat9VatCents: acc.vat9VatCents + q.vat9VatCents,
          vat21VatCents: acc.vat21VatCents + q.vat21VatCents,
          cardSurchargeCents: acc.cardSurchargeCents + q.cardSurchargeCents,
          cardNetCents: acc.cardNetCents + q.cardNetCents,
          cashZettleCents: acc.cashZettleCents + q.cashZettleCents,
          cashDiffCents: acc.cashDiffCents + q.cashDiffCents,
          cashUncountedMonths: acc.cashUncountedMonths + q.cashUncountedMonths,
        }),
        { totalInclVatCents: 0, vat9VatCents: 0, vat21VatCents: 0, cardSurchargeCents: 0, cardNetCents: 0, cashZettleCents: 0, cashDiffCents: 0, cashUncountedMonths: 0 }
      ),
    }))
}

/** Signed euro amount with colour: green when counted ≥ Zettle, red when short. */
function CashDiff({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-zinc-400">gelijk</span>
  const sign = cents > 0 ? '+' : '−'
  return (
    <span className={cents > 0 ? 'text-emerald-700' : 'text-red-600'}>
      {sign}{fmtAdminAmount(Math.abs(cents))}
    </span>
  )
}

function ZettleTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<ZettleData>('/api/admin/finance/zettle/summary')
  const { data: monthsData, refresh: refreshMonths } =
    useAdminFetch<{ months: ZettleMonthRow[] }>('/api/admin/finance/zettle/months')

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const yearGroups = groupQuartersByYear(allQuarters).filter(g => g.year === year)
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const allMonths = monthsData?.months ?? []
  const months = year ? allMonths.filter(m => m.month.startsWith(year)) : allMonths

  function afterSave() {
    refresh()
    refreshMonths()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Verkopen aan boord via de Zettle-pinautomaat (kaart én contant) — drankjes, snacks, extra&apos;s.
          Zettle heeft geen maandmail, dus de cijfers worden per maand van de Verkoopdetails-pagina
          overgenomen. Vul per maand je <strong>zelf getelde contant</strong> in; het verschil met wat
          Zettle rapporteert verschijnt automatisch.
        </p>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={afterSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Zettle-overzicht laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen Zettle-maanden ingevoerd. Zeg &quot;haal de zettle cijfers op&quot; om ze over te nemen.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Totaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW laag (9%)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW hoog (21%)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Toeslagen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kaart (netto)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Contant (Zettle)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Verschil</th>
              </tr>
            </thead>
            {yearGroups.map(group => (
              <tbody key={group.year} className="divide-y divide-zinc-100 bg-white border-b-2 border-zinc-200">
                {group.quarters.map(q => (
                  <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(q.totalInclVatCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat9VatCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat21VatCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-amber-700">−{fmtAdminAmount(q.cardSurchargeCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-500">{fmtAdminAmount(q.cardNetCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-500">{fmtAdminAmount(q.cashZettleCents)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">
                      <CashDiff cents={q.cashDiffCents} />
                      {q.cashUncountedMonths > 0 && (
                        <span className="ml-1 text-amber-500" title={`${q.cashUncountedMonths} maand(en) nog niet geteld`}>*</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-zinc-50 font-semibold text-zinc-900">
                  <td className="px-4 py-3 whitespace-nowrap">Totaal {group.year}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.totalInclVatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.vat9VatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.vat21VatCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-amber-700">−{fmtAdminAmount(group.subtotal.cardSurchargeCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.cardNetCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(group.subtotal.cashZettleCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <CashDiff cents={group.subtotal.cashDiffCents} />
                    {group.subtotal.cashUncountedMonths > 0 && (
                      <span className="ml-1 text-amber-500" title={`${group.subtotal.cashUncountedMonths} maand(en) nog niet geteld`}>*</span>
                    )}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}

      {months.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Per maand — vul je zelf getelde contant in
          </p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {months.map(m => (
              <ZettleMonthRowItem key={m.id} row={m} onSaved={afterSave} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ZettleMonthRowItem({ row, onSaved }: { row: ZettleMonthRow; onSaved: () => void }) {
  const [value, setValue] = useState(
    row.cashCountedCents != null ? (row.cashCountedCents / 100).toFixed(2) : ''
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const cashZettle = row.cashZettleCents ?? 0
  const counted = value.trim() === '' ? null : Math.round(parseFloat(value.replace(',', '.')) * 100)
  const diff = counted == null ? null : counted - cashZettle
  const dirty = counted !== (row.cashCountedCents ?? null)

  async function save() {
    if (counted != null && Number.isNaN(counted)) {
      setErr('Ongeldig bedrag')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/admin/finance/zettle/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: row.month, cashCountedCents: counted }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-5 px-4 py-3 text-sm flex-wrap">
      <span className="font-medium text-zinc-900 w-20 shrink-0 capitalize">{monthLabel(row.month)}</span>
      <span className="text-zinc-500 w-28 shrink-0 text-right whitespace-nowrap hidden sm:inline">
        Totaal {fmtAdminAmount(row.totalInclVatCents)}
      </span>
      <span className="text-zinc-500 w-72 shrink-0 text-right whitespace-nowrap hidden md:inline">
        Kaart {fmtAdminAmount(row.cardGrossCents)}
        {' '}<span className="text-amber-700">−{fmtAdminAmount(row.cardSurchargeCents)}</span>
        {' = '}<span className="text-zinc-900 font-medium">{fmtAdminAmount(row.cardNetCents)}</span>
      </span>
      <span className="text-zinc-600 w-44 shrink-0 text-right whitespace-nowrap">
        Contant (Zettle) <span className="font-medium text-zinc-900">{fmtAdminAmount(cashZettle)}</span>
      </span>
      <div className="flex items-center gap-1.5 ml-auto">
        <label className="text-xs text-zinc-400 shrink-0">Zelf geteld €</label>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="—"
          className="w-24 px-2 py-1 text-right rounded border border-zinc-200 focus:border-zinc-400 focus:outline-none"
        />
        <span className="w-20 text-right text-xs shrink-0">
          {diff != null ? <CashDiff cents={diff} /> : <span className="text-zinc-300">—</span>}
        </span>
        <Button variant="outline" size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Opslaan'}
        </Button>
      </div>
      {err && <span className="text-xs text-red-600 w-full text-right">{err}</span>}
    </div>
  )
}

// ── FareHarbor payout tab (archief — closed period, ended early May 2026) ──

interface FareHarborPayoutData {
  quarters: QuarterFareHarborPayoutSummary[]
  totals: FareHarborPayoutSummaryTotals
}

interface FareHarborPayoutRow {
  id: string
  payoutId: string
  payoutDate: string | null
  bankPayoutDate: string | null
  bankNote: string | null
  grossCents: number | null
  processingFeeCents: number | null
  netCents: number | null
  subtotalPaidCents: number | null
  vat9Cents: number | null
  vat21Cents: number | null
  taxPaidCents: number | null
  lineCount: number | null
}

/** One payout's bank-date confirmation row — editable, so a wrong/missing
 *  date can be corrected without re-uploading the whole CSV. */
function FareHarborBankDateRow({ p, onSaved }: { p: FareHarborPayoutRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(!p.bankPayoutDate)
  const [date, setDate] = useState(p.bankPayoutDate ?? '')
  const [note, setNote] = useState(p.bankNote ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/finance/fareharbor/set-bank-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, bankPayoutDate: date || null, bankNote: note || null }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setEditing(false)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center">
      <span className="font-medium text-zinc-900 w-28 shrink-0">
        {p.bankPayoutDate ? fmtAdminDate(p.bankPayoutDate) : <span className="text-amber-700">nog niet bevestigd</span>}
      </span>
      <span className="text-zinc-500 flex-1 truncate" title={p.bankNote ?? undefined}>
        #{p.payoutId} · {p.lineCount ?? 0} regel{(p.lineCount ?? 0) === 1 ? '' : 's'}
        {p.payoutDate && <span className="text-zinc-400"> · FH-datum {fmtAdminDate(p.payoutDate)}</span>}
        {p.bankNote && !editing && <span className="text-zinc-400"> · {p.bankNote}</span>}
      </span>
      <span className="text-xs text-zinc-400 w-32 text-right shrink-0">
        BTW 9% {fmtAdminAmount(p.vat9Cents ?? 0)} · 21% {fmtAdminAmount(p.vat21Cents ?? 0)}
      </span>
      <span className="font-semibold text-emerald-700 w-24 text-right shrink-0">{fmtAdminAmount(p.netCents ?? 0)}</span>

      {editing ? (
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="rounded border border-zinc-200 px-1.5 py-1 text-xs"
          />
          <input
            type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="notitie (optioneel)"
            className="w-40 rounded border border-zinc-200 px-1.5 py-1 text-xs"
          />
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Bevestigen'}
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-zinc-400 hover:text-zinc-700 shrink-0">
          bewerk
        </button>
      )}
    </div>
  )
}

function FareHarborPayoutTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<FareHarborPayoutData>('/api/admin/finance/fareharbor/summary')
  const { data: payoutsData, refresh: refreshPayouts } =
    useAdminFetch<{ payouts: FareHarborPayoutRow[] }>('/api/admin/finance/fareharbor/payouts')
  const [uploadState, setUploadState] = useState<{ busy: boolean; message: string | null; isError: boolean }>({
    busy: false, message: null, isError: false,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allQuarters = data?.quarters ?? []
  const { years, year, setYear } = useYearFilter(allQuarters.map(q => q.quarter))
  const quarters = year ? allQuarters.filter(q => q.quarter.startsWith(year)) : allQuarters
  const totals = quarters.length > 0
    ? sumFields(quarters, { payoutCount: 0, grossCents: 0, netCents: 0, vat9Cents: 0, vat21Cents: 0 })
    : undefined
  const unconfirmedCount = data?.totals.unconfirmedCount ?? 0
  const unconfirmedNetCents = data?.totals.unconfirmedNetCents ?? 0
  const allPayouts = payoutsData?.payouts ?? []
  const unconfirmedPayouts = allPayouts.filter(p => !p.bankPayoutDate)
  const confirmedPayouts = year
    ? allPayouts.filter(p => p.bankPayoutDate?.startsWith(year))
    : allPayouts.filter(p => p.bankPayoutDate)

  function afterSave() {
    refresh()
    refreshPayouts()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadState({ busy: true, message: null, isError: false })
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/finance/fareharbor/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      const { rowCount, storedCount } = json.data
      setUploadState({
        busy: false, isError: false,
        message: `${storedCount} van ${rowCount} payouts opgeslagen/bijgewerkt`,
      })
      afterSave()
    } catch (err) {
      setUploadState({ busy: false, isError: true, message: err instanceof Error ? err.message : 'Upload mislukt' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 max-w-2xl">
          Archief — FareHarbor verwerkte betalingen zelf en betaalde rechtstreeks uit onder de
          bankomschrijving &quot;FHOFFCOURSE&quot; (bevestigd tegen de bank-tussenrekening), tot de
          overstap naar de eigen Stripe-checkout begin mei 2026 (met één latere nabetaling in september 2026).
          Upload het &quot;Sales-Payout Reconciliation&quot;-rapport uit FareHarbor
          (Detailed report, gegroepeerd op Payout ID, met &quot;Payout Date&quot; als kolom) — FareHarbor
          berekent de 9%/21% BTW al zelf per regel, hier hoeft niets geschat te worden. Beide
          tarieven zijn verschuldigd (FareHarbor was hier de eigen betaalverwerker, geen
          marktplaats met commissie) — geen aftrekbaar bedrag zoals bij BoatLocal/Withlocals/Barqo.
          Belangrijk: FareHarbor&apos;s eigen &quot;Payout Date&quot; is niet betrouwbaar genoeg voor de
          boekhouder — die datum klopt soms niet met wanneer het geld echt op de bank stond, en
          meerdere payouts kunnen samen in één bankoverschrijving zitten. Elke payout hieronder
          heeft daarom een apart bevestigd bank-datum veld, per hand geverifieerd tegen de
          bank-tussenrekening — dát is waar dit tabblad en het BTW-dashboard op groeperen.
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelected} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadState.busy}>
            {uploadState.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Payout CSV uploaden
          </Button>
          <YearSwitcher years={years} year={year} onChange={setYear} />
          <Button variant="outline" size="sm" onClick={afterSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {uploadState.message && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${
          uploadState.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {uploadState.message}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Omzet (bruto)</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.grossCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Netto uitbetaald</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtAdminAmount(totals.netCents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 9%</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.vat9Cents)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">BTW 21%</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{fmtAdminAmount(totals.vat21Cents)}</p>
          </div>
        </div>
      )}

      {unconfirmedCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>{unconfirmedCount} payout{unconfirmedCount === 1 ? '' : 's'} zonder bevestigde bank-datum</strong>{' '}
          ({fmtAdminAmount(unconfirmedNetCents)} netto) — telt nergens in de kwartaaltotalen of het
          BTW-dashboard mee totdat bevestigd. Zie de lijst hieronder.
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> FareHarbor-payouts laden…
        </div>
      )}

      {!isLoading && quarters.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <Receipt className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          Nog geen FareHarbor-payouts geüpload.
        </div>
      )}

      {quarters.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Kwartaal</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Payouts</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Omzet (bruto)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 9%</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">BTW 21%</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Netto uitbetaald</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {quarters.map(q => (
                <tr key={q.quarter} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{quarterLabel(q.quarter)}</td>
                  <td className="px-4 py-3 text-right text-zinc-500">{q.payoutCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtAdminAmount(q.grossCents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat9Cents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-zinc-900">{fmtAdminAmount(q.vat21Cents)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-emerald-700">{fmtAdminAmount(q.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unconfirmedPayouts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Nog te bevestigen (bank-datum)</p>
          <div className="rounded-lg border border-amber-200 overflow-x-auto divide-y divide-amber-100 bg-white">
            {unconfirmedPayouts.map(p => (
              <FareHarborBankDateRow key={p.id} p={p} onSaved={afterSave} />
            ))}
          </div>
        </div>
      )}

      {confirmedPayouts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Per payout (bevestigde bank-datum)</p>
          <div className="rounded-lg border border-zinc-200 overflow-x-auto divide-y divide-zinc-100 bg-white">
            {confirmedPayouts.map(p => (
              <FareHarborBankDateRow key={p.id} p={p} onSaved={afterSave} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Kasboek bronnen tab (planning overview, no live data yet) ───────────────

type KasboekStatus = 'live' | 'haalbaar' | 'onderzoek' | 'computer-use' | 'handmatig' | 'archief'

const STATUS_STYLE: Record<KasboekStatus, string> = {
  live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  haalbaar: 'bg-sky-50 text-sky-700 border-sky-200',
  onderzoek: 'bg-amber-50 text-amber-700 border-amber-200',
  'computer-use': 'bg-sky-50 text-sky-700 border-sky-200',
  handmatig: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  archief: 'bg-zinc-100 text-zinc-500 border-zinc-200',
}

const STATUS_LABEL: Record<KasboekStatus, string> = {
  live: 'Live',
  haalbaar: 'Haalbaar — key nodig',
  onderzoek: 'Onderzoek nodig',
  'computer-use': 'Gepland (computer-use)',
  handmatig: 'Handmatig',
  archief: 'Archief',
}

interface KasboekBron {
  bron: string
  huidigeSpoor: string
  aanpak: string
  status: KasboekStatus
}

const KASBOEK_BRONNEN: KasboekBron[] = [
  {
    bron: 'Stripe (website)',
    huidigeSpoor: 'Rechtstreeks via Stripe-webhook, realtime',
    aanpak: 'Al automatisch — zie tabblad "BTW & Stripe" hierboven',
    status: 'live',
  },
  {
    bron: 'Withlocals',
    huidigeSpoor: 'Twee mailtjes per boeking/maand: "New invoice for booking" (PDF, per boeking) + maandelijkse "New payout" (geen bijlage, tekst in de mail)',
    aanpak: 'Live — zie tabblad "Withlocals" hierboven. Geen Stripe API-key nodig: de twee mailtjes samen geven alles (omzet, 9% BTW, hun 21%-commissie-BTW, netto uitbetaling)',
    status: 'live',
  },
  {
    bron: 'Barqo',
    huidigeSpoor: 'Geen mailtje/CSV — alleen barqo.co/dashboard/booking-overview. Bevestigd: zelfde Stripe-account als Off Course zelf (acct_1T8kWuGh1qCF71Ta, "Off Course Canal Cruises"), dus geen apart account/API-key nodig zoals eerder gedacht',
    aanpak: 'Live — zie tabblad "Barqo" hierboven. Zeer laag volume (2 bekende boekingen, beide van vóór onze eigen Stripe-koppeling in maart 2026); nieuwe boekingen worden via een upsert opgeslagen zodra ze op het dashboard verschijnen',
    status: 'live',
  },
  {
    bron: 'GetYourGuide',
    huidigeSpoor: '"Your payment is confirmed" mail met een PDF-bijlage per uitbetaling — geen boekingsuitsplitsing zoals bij Viator',
    aanpak: 'Live — zie tabblad "GetYourGuide" hierboven (nu nog handmatig uploaden)',
    status: 'live',
  },
  {
    bron: 'Viator / TripAdvisor',
    huidigeSpoor: 'Maandelijkse "Payment Advice"-mail (finance@viator.com) met een .xlsx-bijlage per uitbetaling, per boeking uitgesplitst',
    aanpak: 'Live — zie tabblad "Viator" hierboven (nu nog handmatig uploaden, BTW-uitsplitsing nog niet bepaald)',
    status: 'live',
  },
  {
    bron: 'Click & Boat',
    huidigeSpoor: '"Download the summary"-CSV op clickandboat.com/en/account/bookings — dekt de volledige historie, per boeking netto + bruto bedrag',
    aanpak: 'Live — zie tabblad "Click & Boat" hierboven (nu nog handmatig uploaden, betaalt per boeking direct na de tocht uit)',
    status: 'live',
  },
  {
    bron: 'GetMyBoat',
    huidigeSpoor: '"Getmyboat has sent you money"-mail (geen bijlage, tekst in de mail, meerdere boekingen per uitbetaling, exact boekingsnummer als match-sleutel)',
    aanpak: 'Live — zie tabblad "GetMyBoat" hierboven (geen uploadknopje, sync-skill post de payout-mail rechtstreeks)',
    status: 'live',
  },
  {
    bron: 'Zettle',
    aanpak: 'Live — zie tabblad "Zettle" hierboven (cijfers per maand van de Verkoopdetails-pagina overgenomen, plus contant-controle)',
    huidigeSpoor: 'Geen automatische maandrapportage — cijfers worden per maand van het Zettle-portaal overgenomen',
    status: 'live',
  },
  {
    bron: 'Contant geld',
    huidigeSpoor: 'Geen digitaal spoor',
    aanpak: 'Moet handmatig ingevoerd worden in het kasboek — hier valt niets te automatiseren',
    status: 'handmatig',
  },
  {
    bron: 'FareHarbor',
    huidigeSpoor: 'FareHarbor verwerkte zelf betalingen (uitbetaald onder bankomschrijving "FHOFFCOURSE"), tot de overstap naar Stripe-checkout begin mei 2026 — 58 historische payouts t/m mei 2026 plus 1 nabetaling in september 2026 geïmporteerd en tegen de bank-tussenrekening geverifieerd (matcht tot op de cent)',
    aanpak: 'Live — zie tabblad "FareHarbor" hierboven. Archief: 59 payouts gereconcilieerd',
    status: 'live',
  },
  {
    bron: 'BoatLocal',
    huidigeSpoor: 'Maandelijkse "Operator Invoice" PDF-mail met volledige BTW-uitsplitsing (9% omzet, 21% commissie) en elke boeking — een echte payout naar Off Course, geen ander bedrijf uitfilteren',
    aanpak: 'Live — zie tabblad "BoatLocal" hierboven (nu nog handmatig uploaden)',
    status: 'live',
  },
  {
    bron: 'Revolut',
    huidigeSpoor: '"Merchant reconciliation statement" CSV uit het Revolut Business dashboard (Rederij Zoomers & Schenk EUR Merchant) — betaallinkjes voor losse boekingen/drankjes/merch. Geen vaste BTW-regel per transactie: omschrijving alleen is niet betrouwbaar genoeg, dus elke transactie moet je zelf een keer bevestigen (9%/21%, soms allebei binnen één transactie)',
    aanpak: 'Live — zie tabblad "Revolut" hierboven (CSV uploaden + per transactie classificeren)',
    status: 'live',
  },
]

function KasboekBronnenTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 max-w-3xl">
        Overzicht van alle inkomstenbronnen en hoe elke bron waarschijnlijk in het digitale kasboek
        terechtkomt. Dit is een planning/status-overzicht — nog geen live data. Zodra een bron
        &quot;Haalbaar&quot; of &quot;Live&quot; is, kan hij hier een eigen tabblad krijgen zoals BTW &amp; Stripe.
      </p>

      <div className="rounded-lg border border-zinc-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Bron</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Hoe komt het nu binnen</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Aanpak voor kasboek</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {KASBOEK_BRONNEN.map(row => (
              <tr key={row.bron} className="hover:bg-zinc-50 transition-colors align-top">
                <td className="px-4 py-3 font-medium text-zinc-900 whitespace-nowrap">{row.bron}</td>
                <td className="px-4 py-3 text-zinc-600 max-w-xs">{row.huidigeSpoor}</td>
                <td className="px-4 py-3 text-zinc-600 max-w-xs">{row.aanpak}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
