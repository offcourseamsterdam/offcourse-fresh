'use client'

import { Bot } from 'lucide-react'
import type { AiReferralRow } from '@/lib/tracking/ai-referrers'

interface Props {
  engines: AiReferralRow[]
  isLoading: boolean
}

export function AiEnginesTable({ engines, isLoading }: Props) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-sm">
      <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-500" />
            Prestaties per AI Zoekmachine &amp; Assistent
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Welke AI-modellen bevelen Off Course het vaakst aan, en sturen ze bezoekers met specifieke afvaarten door?
          </p>
        </div>
        {engines.length > 0 && (
          <span className="text-xs text-zinc-400 tabular-nums">
            {engines.length} actieve assistenten
          </span>
        )}
      </div>

      {engines.length === 0 && isLoading && (
        <div className="p-10 text-center text-zinc-400 text-sm animate-pulse">
          Laden...
        </div>
      )}

      {engines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/75 text-zinc-500 font-medium">
                <th className="py-3 px-5">Zoekmachine / LLM</th>
                <th className="py-3 px-5 text-right">Totale Bezoeken</th>
                <th className="py-3 px-5 text-right">Unieke Bezoekers</th>
                <th className="py-3 px-5 text-right font-semibold text-violet-950">
                  Beschikbaarheids-Links (?date=)
                </th>
                <th className="py-3 px-5 text-right">Boekingen</th>
                <th className="py-3 px-5 text-right">Omzet</th>
                <th className="py-3 px-5 text-right">Conversie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {engines.map((e) => {
                const conv = e.sessions > 0 ? ((e.bookings / e.sessions) * 100).toFixed(1) : '0.0'
                const availRatio = e.sessions > 0 ? Math.round((e.availabilitySessions / e.sessions) * 100) : 0
                const isCore = ['chatgpt', 'perplexity', 'gemini', 'claude'].includes(e.key)

                return (
                  <tr key={e.key} className={`hover:bg-zinc-50/80 transition-colors ${e.sessions === 0 && isCore ? 'opacity-50' : ''}`}>
                    <td className="py-4 px-5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-900 text-sm">{e.label}</span>
                        {e.availabilitySessions > 0 && (
                          <span className="text-[10px] bg-violet-100 text-violet-700 font-medium px-1.5 py-0.5 rounded">
                            Actieve slots
                          </span>
                        )}
                        {e.sessions === 0 && isCore && (
                          <span className="text-[10px] bg-zinc-100 text-zinc-400 px-1.5 py-0.5 rounded">
                            Geen verkeer
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-5 text-right tabular-nums font-medium text-zinc-800">
                      {e.sessions}
                    </td>
                    <td className="py-4 px-5 text-right tabular-nums text-zinc-500">
                      {e.visitors}
                    </td>
                    <td className="py-4 px-5 text-right tabular-nums">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-semibold text-violet-700">{e.availabilitySessions}</span>
                        <span className="text-[11px] text-zinc-400">({availRatio}%)</span>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-right tabular-nums font-medium text-zinc-900">
                      {e.bookings}
                    </td>
                    <td className="py-4 px-5 text-right tabular-nums font-semibold text-emerald-600">
                      €{Math.round(e.revenueEuros)}
                    </td>
                    <td className="py-4 px-5 text-right tabular-nums text-zinc-600">
                      {conv}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-6 py-4 bg-zinc-50/50 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-500">
        <span>
          Let op: Google AI Overviews verschijnen als regulier <code className="bg-zinc-100 px-1 py-0.5 rounded">google.com</code> verkeer.
        </span>
        <span className="text-zinc-400">
          Attributie gebaseerd op first-party sessies &amp; FareHarbor/Stripe boekingen.
        </span>
      </div>
    </div>
  )
}
