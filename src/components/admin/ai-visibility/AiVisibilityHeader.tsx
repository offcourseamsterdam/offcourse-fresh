'use client'

import { Sparkles, RefreshCw } from 'lucide-react'
import { PeriodSelector, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'

interface Props {
  period: PeriodKey
  onPeriodChange: (period: PeriodKey, from: string, to: string) => void
  isSyncing: boolean
  onManualSync: () => void
}

export function AiVisibilityHeader({
  period,
  onPeriodChange,
  isSyncing,
  onManualSync,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-violet-600" />
          AI Visibility &amp; LLM Zoekmachines
        </h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
          Meet hoe AI-assistenten (ChatGPT, Perplexity, Gemini, Claude) Off Course ontdekken,
          real-time afvaarten citeren via deep links, en bijdragen aan boekingen en omzet.
        </p>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
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
