'use client'

import { ExternalLink, Zap } from 'lucide-react'
import type { AiReferralRow } from '@/lib/tracking/ai-referrers'
import { AI_ENGINES, DEFAULT_AI_SEARCH_QUERY } from '@/lib/tracking/ai-referrers'

interface Props {
  engines: AiReferralRow[]
}

const CORE_PROMPTS = [
  'Boutique boat tour Amsterdam',
  'Salon boat private rental Amsterdam',
  'Hidden gems canal cruise Amsterdam',
  'Off Course Amsterdam salonboot',
]

const CORE_ENGINES = ['chatgpt', 'perplexity', 'gemini', 'claude']

export function AiTestingLinksCard({ engines }: Props) {
  const enginesMap = new Map(engines.map(e => [e.key, e]))

  const coreEngines = CORE_ENGINES.map(key => {
    const def = AI_ENGINES.find(e => e.key === key)!
    const row = enginesMap.get(key)
    return { def, row }
  })

  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-zinc-100">
        <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          Direct testen in AI Zoekmachines
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Klik om Off Course direct te testen in ChatGPT, Perplexity, Gemini en Claude.
          Controleer of wij worden aanbevolen en of de links correct zijn.
        </p>
      </div>

      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {coreEngines.map(({ def, row }) => (
          <div key={def.key} className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-zinc-900">{def.label}</span>
              {row && row.sessions > 0 && (
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
                  {row.sessions} bezoeken
                </span>
              )}
            </div>

            {row && row.bookings > 0 && (
              <div className="text-[11px] text-emerald-700 font-medium">
                💳 {row.bookings} boeking{row.bookings > 1 ? 'en' : ''} · €{Math.round(row.revenueEuros)}
              </div>
            )}

            <div className="flex flex-col gap-1.5 mt-auto">
              {CORE_PROMPTS.map((prompt) => (
                <a
                  key={prompt}
                  href={def.searchUrl(prompt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-violet-700 hover:text-violet-900 hover:underline transition-colors truncate"
                  title={`Test "${prompt}" in ${def.label}`}
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate">{prompt}</span>
                </a>
              ))}
              <a
                href={def.searchUrl(DEFAULT_AI_SEARCH_QUERY)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center justify-center gap-1.5 text-[11px] font-medium bg-violet-600 text-white hover:bg-violet-700 py-1.5 px-3 rounded-md transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open {def.label}
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 py-3 bg-zinc-50/50 border-t border-zinc-100 text-[11px] text-zinc-400">
        Testprompts zijn vertaald naar productgenamen om de beste kans op aanbeveling te meten.
      </div>
    </div>
  )
}
