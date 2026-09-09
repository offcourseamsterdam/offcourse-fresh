'use client'

import { Sparkles, RefreshCw } from 'lucide-react'
import { PeriodSelector, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'

interface Props {
  isDemo: boolean
  demoMode: boolean
  onToggleDemo: () => void
  period: PeriodKey
  onPeriodChange: (period: PeriodKey, from: string, to: string) => void
  isSyncing: boolean
  onManualSync: () => void
}

export function AiVisibilityHeader({
  isDemo,
  demoMode,
  onToggleDemo,
  period,
  onPeriodChange,
  isSyncing,
  onManualSync,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-violet-600" />
            AI Visibility &amp; LLM Zoekmachines
          </h1>
          {isDemo && (
            <span className="text-[11px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-200">
              Voorbeelddata
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
          Meet hoe AI-assistenten (ChatGPT, Perplexity, Gemini, Claude) Off Course ontdekken,
          real-time afvaarten citeren via deep links, en bijdragen aan boekingen en omzet.
        </p>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
        <button
          onClick={onToggleDemo}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            demoMode
              ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-sm'
              : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
          }`}
        >
          {demoMode ? 'Sluit voorbeelddata' : 'Toon voorbeelddata'}
        </button>

        <PeriodSelector value={period} onChange={onPeriodChange} />

        <button
          onClick={onManualSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Synchroniseren...' : 'Sync Nu'}</span>
        </button>
      </div>
    </div>
  )
}
