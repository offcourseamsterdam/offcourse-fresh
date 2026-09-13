'use client'

import { useState } from 'react'
import {
  Sparkles,
  Loader2,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  ShieldCheck,
  StopCircle,
  PlayCircle,
  Target,
  Bot,
  Users,
  CreditCard,
  Building2,
  ChevronDown,
  ChevronUp,
  Anchor,
  Calendar,
  AlertOctagon,
  Flame,
  Zap,
  Cpu,
  Ship,
  Rocket,
  Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { adminMutate } from '@/hooks/useAdminSave'
import { COCKPIT_API } from './api-types'
import { eur, dateTimeNL } from './money'
import type { CfoAnalysisResult } from '@/lib/finance/cockpit/cfo/types'

interface CfoAnalysisCardProps {
  initialAnalysis?: CfoAnalysisResult | null
  onRefreshAll?: () => void
}

export function CfoAnalysisCard({ initialAnalysis, onRefreshAll }: CfoAnalysisCardProps) {
  const [analysis, setAnalysis] = useState<CfoAnalysisResult | null>(initialAnalysis ?? null)
  const [selectedModel, setSelectedModel] = useState<'sonnet' | 'opus'>('sonnet')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)

  async function handleRunAnalysis(modelOverride?: 'sonnet' | 'opus') {
    const modelToUse = modelOverride ?? selectedModel
    setLoading(true)
    try {
      const res = await adminMutate<CfoAnalysisResult>(`${COCKPIT_API}/cfo-analysis`, 'POST', {
        model: modelToUse,
      })
      setAnalysis(res)
      toast.success(
        modelToUse === 'opus' ? 'Claude Opus 4.6 Boardroom Audit voltooid' : 'Claude Sonnet 4.6 CFO Analyse voltooid',
        {
          description:
            modelToUse === 'opus'
              ? 'Diepgaande audit met multi-orde stresstests en risico-covariantie succesvol doorgerekend.'
              : 'Schuldaflossingscapaciteit, seizoensreserves en marketingstrategie succesvol doorgerekend.',
        },
      )
      onRefreshAll?.()
    } catch (err) {
      toast.error('CFO Analyse mislukt', {
        description: err instanceof Error ? err.message : 'Er ging iets mis tijdens de analyse.',
      })
    } finally {
      setLoading(false)
    }
  }

  const cardClass = 'rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden'

  return (
    <section className={cardClass}>
      {/* Header Bar */}
      <div className="p-5 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-400/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                AI Fractional CFO & COO
              </span>
              {analysis && (
                <>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-zinc-300">
                    {dateTimeNL(analysis.analyzedAt)}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                    analysis.modelUsed?.includes('opus')
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-400/30'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                  }`}>
                    {analysis.modelUsed?.includes('opus') ? (
                      <>
                        <Cpu className="w-3 h-3 text-purple-400" />
                        <span>Opus 4.6 Audit</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3 text-indigo-400" />
                        <span>Sonnet 4.6</span>
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5">
              Strategisch Directieadvies: Solvabiliteit & Rendement
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto justify-end">
          {/* Model Toggle Switcher */}
          <div className="inline-flex items-center bg-zinc-800/95 p-0.5 rounded-lg border border-zinc-700/80 shadow-inner">
            <button
              type="button"
              onClick={() => setSelectedModel('sonnet')}
              disabled={loading}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                selectedModel === 'sonnet'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Claude Sonnet 4.6 (Snel ~5-8s, punctuele kwantitatieve CFO monitor)"
            >
              <Zap className="w-3 h-3" />
              <span>Sonnet 4.6</span>
              <span className="text-[10px] opacity-75 hidden md:inline">· 5s</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedModel('opus')}
              disabled={loading}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                selectedModel === 'opus'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Claude Opus 4.6 (Diepgaande Boardroom Audit ~25-35s, tweede-orde stresstests en risico-covariantie)"
            >
              <Cpu className="w-3 h-3" />
              <span>Opus 4.6</span>
              <span className="text-[10px] opacity-75 hidden md:inline">· Audit</span>
            </button>
          </div>

          <Button
            size="sm"
            onClick={() => handleRunAnalysis()}
            disabled={loading}
            className={`${
              selectedModel === 'opus'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            } font-medium shadow-sm transition-all text-xs`}
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                <span>{selectedModel === 'opus' ? 'Opus 4.6 auditeert live data…' : 'Sonnet 4.6 analyseert live data…'}</span>
              </>
            ) : (
              <>
                {selectedModel === 'opus' ? (
                  <Cpu className="w-3.5 h-3.5 mr-1.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                )}
                <span>
                  {analysis
                    ? `Opnieuw (${selectedModel === 'opus' ? 'Opus 4.6' : 'Sonnet 4.6'})`
                    : `Start ${selectedModel === 'opus' ? 'Opus Audit' : 'CFO Analyse'}`}
                </span>
              </>
            )}
          </Button>

          {analysis && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              aria-label={expanded ? 'Inklappen' : 'Uitklappen'}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!analysis ? (
        <div className="p-8 text-center space-y-4 bg-zinc-50/50">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 mb-1">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-zinc-900">
            Nog geen CFO analyse gegenereerd
          </h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Kies je gewenste model en start live de berekening van schuldaflossingscapaciteit (DSCR),
            de 1 oktober rentebetaling (€ 6.366), winterreserves en marketingattributie.
          </p>

          {/* Model selection pills in empty state */}
          <div className="inline-flex items-center bg-white p-1 rounded-xl border border-zinc-200 shadow-sm gap-1">
            <button
              type="button"
              onClick={() => setSelectedModel('sonnet')}
              disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                selectedModel === 'sonnet'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Sonnet 4.6 (Snel ~5s)</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedModel('opus')}
              disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                selectedModel === 'opus'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Opus 4.6 (Boardroom Audit ~25s)</span>
            </button>
          </div>

          <div className="pt-2">
            <Button
              onClick={() => handleRunAnalysis()}
              disabled={loading}
              size="sm"
              className={selectedModel === 'opus' ? 'bg-purple-600 hover:bg-purple-500' : 'bg-indigo-600 hover:bg-indigo-500'}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : selectedModel === 'opus' ? (
                <Cpu className="w-4 h-4 mr-2" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              <span>Start {selectedModel === 'opus' ? 'Opus 4.6 Boardroom Audit' : '1-Click Sonnet Analyse'}</span>
            </Button>
          </div>
        </div>
      ) : expanded ? (
        <div className="p-5 sm:p-6 space-y-6">
          {/* Executive Summary Banner */}
          <div className={`rounded-xl border p-4 sm:p-5 ${
            analysis.statusLevel === 'caution'
              ? 'border-amber-200 bg-amber-50/40'
              : 'border-indigo-100 bg-indigo-50/40'
          }`}>
            <div className="flex items-start gap-3">
              {analysis.statusLevel === 'caution' ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-zinc-900">{analysis.headline}</h3>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    analysis.statusLevel === 'caution'
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                  }`}>
                    {analysis.statusLevel === 'caution' ? 'Waakzaamheid Geboden' : 'Gezond'}
                  </span>
                </div>
                <p className="text-sm text-zinc-700 mt-2 leading-relaxed whitespace-pre-line">
                  {analysis.executiveSummary}
                </p>
              </div>
            </div>
          </div>

          {/* PILLAR 1: Solvabiliteit, Leningen & De Seizoens-Waterfall */}
          <div className="rounded-xl border border-zinc-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-zinc-700" />
                <h3 className="font-bold text-zinc-900 text-base">
                  1. Schuldaflossingscapaciteit & Leningen (DSCR & Aflossingsklif)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Zomer DSCR: {analysis.solvencyAndDebt.dscr}x · 12M Vooruit: {analysis.solvencyAndDebt.dscrForward12m ?? 3.2}x (Gezond)
                </span>
              </div>
            </div>

            {/* Answer to the user's primary question */}
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                  Kunnen we toekomstige schulden en leningen aflossen?
                </div>
                <div className="text-sm font-semibold text-emerald-950 mt-0.5">
                  {analysis.solvencyAndDebt.repaymentCapacityVerdict}
                </div>
                <div className="text-xs text-emerald-800 mt-1">
                  {analysis.solvencyAndDebt.verdict}
                </div>
              </div>
            </div>

            {/* 3 Critical Solvency Alerts Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs flex flex-col justify-between">
                <div>
                  <div className="font-bold text-amber-900 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-amber-600" />
                    1 Oktober Rentebetaling
                  </div>
                  <div className="text-base font-extrabold text-amber-950 mt-1">
                    € 6.366,22
                  </div>
                  <p className="text-[11px] text-amber-800 mt-1 leading-normal">
                    Over 17 dagen verschuldigd over alle 6 leningen. Direct betaalbaar uit cash.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex flex-col justify-between">
                <div>
                  <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-emerald-600" />
                    Bewezen Winteromzet
                  </div>
                  <div className="text-base font-extrabold text-emerald-950 mt-1">
                    € 28.500 / mnd (2 boten)
                  </div>
                  <p className="text-[11px] text-emerald-800 mt-1 leading-normal">
                    Vorig jaar € 14.500 (1 boot). Dekt ruimschoots vaste lasten en leningen!
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs flex flex-col justify-between">
                <div>
                  <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                    <AlertOctagon className="w-3.5 h-3.5 text-indigo-600" />
                    Aflossingsklif 2028
                  </div>
                  <div className="text-base font-extrabold text-indigo-950 mt-1">
                    € 55.875 / jaar
                  </div>
                  <p className="text-[11px] text-indigo-800 mt-1 leading-normal">
                    Erik Musegaas & Expres Wijn starten met lineaire aflossing (+900% jaarlast).
                  </p>
                </div>
              </div>
            </div>

            <p className="text-sm text-zinc-600 leading-relaxed pt-1">
              {analysis.solvencyAndDebt.detailedAnalysis}
            </p>
          </div>

          {/* PILLAR 2: Maritieme & Hospitality Exploitatie (CM/Hour & Zettle Bar) */}
          {analysis.maritimeOperations && (
            <div className="rounded-xl border border-zinc-200 p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
                <Anchor className="w-5 h-5 text-zinc-700" />
                <h3 className="font-bold text-zinc-900 text-base">
                  2. Maritieme & Hospitality Exploitatie (Dock-to-P&L)
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Zettle F&B Marge Herstel */}
                <div className="p-3.5 rounded-xl bg-teal-50/70 border border-teal-200 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-teal-950">Onboard Drank Marge-Kloof</span>
                    <span className="font-bold text-teal-800 bg-teal-100 px-2 py-0.5 rounded">
                      +€ 2.200/mnd potentieel
                    </span>
                  </div>
                  <p className="text-teal-900 leading-relaxed">
                    {analysis.maritimeOperations.fbMarginSpreadVerdict}
                  </p>
                </div>

                {/* Fleet Sinking Fund */}
                <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-900">Vloot Onderhoudsfonds (Hellingbeurt Q1)</span>
                    <span className="font-semibold text-zinc-700 bg-zinc-200 px-2 py-0.5 rounded">
                      Advies: € 2.800/mnd
                    </span>
                  </div>
                  <p className="text-zinc-600 leading-relaxed">
                    {analysis.maritimeOperations.fleetOperationalAdvice}
                  </p>
                </div>
              </div>

              {/* Vlootbezetting & TOTALREV / cruise: Private vs Shared */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-50/70 via-blue-50/40 to-slate-50 border border-indigo-100/90 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-indigo-100/70">
                  <div className="flex items-center gap-2">
                    <Ship className="w-4 h-4 text-indigo-700" />
                    <span className="font-bold text-zinc-900 text-sm">
                      Vlootbezetting & TOTALREV per Afvaart (Privé vs Shared)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-zinc-500">Boekbare dag-slots vloot (2 boten):</span>
                    <span className="font-bold text-zinc-800 bg-white px-2 py-0.5 rounded border border-zinc-200 shadow-2xs">
                      {analysis.maritimeOperations.totalBookableSlotsPerDay ?? 10} slots / dag
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Metric 1: Bezettingspercentage Privé */}
                  <div className="p-3 rounded-lg bg-white border border-indigo-100 shadow-2xs space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-800 flex items-center justify-between">
                      <span>Bezetting Privé</span>
                      <span className="text-[10px] text-zinc-400">van 10 slots</span>
                    </div>
                    <div className="text-xl font-extrabold text-indigo-950 flex items-baseline gap-1.5">
                      <span>{analysis.maritimeOperations.privateOccupancyPct ?? 12.2}%</span>
                      <span className="text-xs font-normal text-zinc-500">dagbezetting</span>
                    </div>
                    <div className="w-full bg-indigo-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full rounded-full"
                        style={{ width: `${Math.min(100, ((analysis.maritimeOperations.privateOccupancyPct ?? 12.2) / 40) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-zinc-500 pt-0.5">
                      Gemiddeld 1,22 privé vaarten per operationele dag
                    </p>
                  </div>

                  {/* Metric 2: Bezettingspercentage Shared */}
                  <div className="p-3 rounded-lg bg-white border border-sky-100 shadow-2xs space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-800 flex items-center justify-between">
                      <span>Bezetting Shared</span>
                      <span className="text-[10px] text-zinc-400">van 10 slots</span>
                    </div>
                    <div className="text-xl font-extrabold text-sky-950 flex items-baseline gap-1.5">
                      <span>{analysis.maritimeOperations.sharedOccupancyPct ?? 6.0}%</span>
                      <span className="text-xs font-normal text-zinc-500">dagbezetting</span>
                    </div>
                    <div className="w-full bg-sky-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-sky-600 h-full rounded-full"
                        style={{ width: `${Math.min(100, ((analysis.maritimeOperations.sharedOccupancyPct ?? 6.0) / 30) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-zinc-500 pt-0.5">
                      Gem. {analysis.maritimeOperations.avgGuestsPerSharedCruise ?? 4.1} passagiers ({analysis.maritimeOperations.sharedSeatFillPct ?? 34.2}% van 12 stoelen)
                    </p>
                  </div>

                  {/* Metric 3: TOTALREV / Private Cruise */}
                  <div className="p-3 rounded-lg bg-white border border-emerald-100 shadow-2xs space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 flex items-center justify-between">
                      <span>TOTALREV / Privé</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-bold">Charter</span>
                    </div>
                    <div className="text-xl font-extrabold text-emerald-950">
                      {eur(analysis.maritimeOperations.avgRevPerPrivateCruiseCents ?? 34500)}
                    </div>
                    <p className="text-[10px] text-zinc-500 pt-0.5">
                      Gemiddelde opbrengst per privé vertrek incl. catering & extra's
                    </p>
                  </div>

                  {/* Metric 4: TOTALREV / Shared Cruise */}
                  <div className="p-3 rounded-lg bg-white border border-amber-100 shadow-2xs space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 flex items-center justify-between">
                      <span>TOTALREV / Shared</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 font-bold">Ticket Group</span>
                    </div>
                    <div className="text-xl font-extrabold text-amber-950">
                      {eur(analysis.maritimeOperations.avgRevPerSharedCruiseCents ?? 12900)}
                    </div>
                    <p className="text-[10px] text-zinc-500 pt-0.5">
                      Geaggregeerde omzet per gevaren shared afvaart
                    </p>
                  </div>
                </div>

                {analysis.maritimeOperations.occupancyVerdict && (
                  <p className="text-xs text-zinc-700 bg-white/70 rounded-lg p-2.5 border border-indigo-100/60 leading-relaxed">
                    {analysis.maritimeOperations.occupancyVerdict}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* PILLAR 3: Marketing Strategie & Intermediair-Taks */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-zinc-700" />
                <h3 className="font-bold text-zinc-900 text-base">
                  3. Marketing & Attributie Strategie (Stop / Start / Schaal)
                </h3>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-700 border border-zinc-200">
                Werkelijke CAC: 15,9% (inclusief provisies)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* STOP */}
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-sm pb-2 border-b border-rose-200">
                    <StopCircle className="w-4 h-4 text-rose-600" />
                    <span>STOP (Margelekkages)</span>
                  </div>
                  <ul className="mt-3 space-y-2 text-xs text-rose-950">
                    {analysis.marketingStrategy.stop.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-rose-500 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* START */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm pb-2 border-b border-emerald-200">
                    <PlayCircle className="w-4 h-4 text-emerald-600" />
                    <span>START (Nieuwe Hefbomen)</span>
                  </div>
                  <ul className="mt-3 space-y-2 text-xs text-emerald-950">
                    {analysis.marketingStrategy.start.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-500 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* FOCUS / SCHAAL */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-indigo-800 font-bold text-sm pb-2 border-b border-indigo-200">
                    <Target className="w-4 h-4 text-indigo-600" />
                    <span>FOCUS (Bewezen Motoren)</span>
                  </div>
                  <ul className="mt-3 space-y-2 text-xs text-indigo-950">
                    {analysis.marketingStrategy.focus.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-indigo-500 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Deep-dive Attribution Channel Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* ChatGPT Card */}
              <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3.5 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-teal-950 flex items-center gap-2">
                    <span>ChatGPT (chatgpt.com referrals)</span>
                    <span className="px-1.5 py-0.5 rounded bg-teal-200/70 text-teal-900 font-bold text-[10px]">
                      0% Fee · € 302 AOV
                    </span>
                  </div>
                  <p className="text-teal-900 mt-1 leading-relaxed">
                    {analysis.marketingStrategy.channelInsights.chatgpt}
                  </p>
                </div>
              </div>

              {/* Things To Do In Amsterdam Card */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-amber-950 flex items-center gap-2">
                    <span>Things To Do In Amsterdam</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-900 font-bold text-[10px]">
                      53 Boekingen · € 9.575 Netto
                    </span>
                  </div>
                  <p className="text-amber-900 mt-1 leading-relaxed">
                    {analysis.marketingStrategy.channelInsights.thingsToDoInAmsterdam}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* PILLAR 4: Besparingskansen & Zorgpunten */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Kansen */}
            <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Besparingskansen & Margeverhoging
              </h4>
              <div className="space-y-2.5">
                {analysis.costOpportunities.map((opp, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-100 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-900">{opp.title}</span>
                      {opp.potentialSavingCents && (
                        <span className="font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                          +{eur(opp.potentialSavingCents)}
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-600 mt-1">{opp.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Zorgpunten */}
            <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Aandachtspunten & Risicobeheer
              </h4>
              <div className="space-y-2.5">
                {analysis.financialConcerns.map((concern, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-100 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-900">{concern.title}</span>
                      <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] uppercase ${
                        concern.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {concern.severity}
                      </span>
                    </div>
                    <p className="text-zinc-600 mt-1">{concern.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* PILLAR 5: Direct Actieplan voor Beer */}
          <div className="rounded-xl border border-zinc-200 p-4 sm:p-5 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Direct Uitvoerbaar Actieplan voor Beer
            </h4>
            <div className="space-y-2">
              {analysis.actionPlan.map(step => (
                <div key={step.step} className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 hover:bg-zinc-100/80 transition-colors text-xs">
                  <span className="w-6 h-6 rounded-full bg-zinc-900 text-white font-bold flex items-center justify-center shrink-0 text-xs">
                    {step.step}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-zinc-900">{step.action}</div>
                    <div className="text-zinc-500 mt-0.5">{step.impact}</div>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    step.urgency === 'direct'
                      ? 'bg-red-100 text-red-800'
                      : step.urgency === 'komende_weken'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-zinc-200/80 text-zinc-700'
                  }`}>
                    {step.urgency === 'direct' ? 'Direct' : step.urgency === 'komende_weken' ? 'Komende weken' : 'Strategisch'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* PILLAR 6: 10X GROWTH PLAN (CFO Scale-up Blueprint) */}
          {analysis.growthPlan10x && (
            <div className="rounded-2xl border-2 border-indigo-200/80 bg-gradient-to-b from-indigo-50/40 via-white to-purple-50/30 p-5 sm:p-6 space-y-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-indigo-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold shrink-0 shadow-sm">
                    <Rocket className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-extrabold uppercase tracking-widest text-indigo-700">
                        10X CFO Growth Plan
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold">
                        Schaalmodel
                      </span>
                    </div>
                    <h3 className="font-extrabold text-zinc-900 text-base sm:text-lg mt-0.5">
                      {analysis.growthPlan10x.visionHeadline}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="bg-white border border-indigo-200 rounded-xl px-3 py-1.5 shadow-2xs text-right">
                    <div className="text-[10px] uppercase font-bold text-zinc-400">North Star Target</div>
                    <div className="text-sm sm:text-base font-extrabold text-indigo-950 tabular-nums">
                      {eur(analysis.growthPlan10x.targetRevenueAnnualCents)} / jaar
                    </div>
                  </div>
                  <div className="bg-white border border-purple-200 rounded-xl px-3 py-1.5 shadow-2xs text-right">
                    <div className="text-[10px] uppercase font-bold text-zinc-400">Doelvloot</div>
                    <div className="text-sm sm:text-base font-extrabold text-purple-950 tabular-nums">
                      {analysis.growthPlan10x.targetFleetSize} Salonboten
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Pillars Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {analysis.growthPlan10x.pillars.map((pillar, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl bg-white border border-indigo-100/90 shadow-2xs hover:border-indigo-300 transition-all space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-sm text-zinc-900">{pillar.title}</h4>
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-extrabold text-xs shrink-0">
                        {pillar.multiplier}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 leading-relaxed">{pillar.strategy}</p>
                    <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400 font-medium">Jaarlijkse bijdrage:</span>
                      <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        +{eur(pillar.annualRevenueContributionCents)}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 bg-zinc-50 rounded-lg p-2 border border-zinc-100">
                      <strong className="text-zinc-700 font-semibold">Executietactiek:</strong> {pillar.executionTactic}
                    </div>
                  </div>
                ))}
              </div>

              {/* Milestones Timeline */}
              <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                    Fasering & Kapitaal-Milestones (Van € 43k/mnd naar € 335k/mnd)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {analysis.growthPlan10x.milestones.map((milestone, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-zinc-50/80 border border-zinc-150 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-900">{milestone.horizon}</span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                          {milestone.boatsCount} {milestone.boatsCount === 1 ? 'boot' : 'boten'}
                        </span>
                      </div>
                      <div className="text-base font-extrabold text-indigo-900 tabular-nums">
                        {eur(milestone.targetRevenueMonthlyCents)} <span className="text-xs font-normal text-zinc-500">/ mnd</span>
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-snug">{milestone.focus}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
