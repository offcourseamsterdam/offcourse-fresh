'use client'

import { ArrowUpRight, Info, Calendar, Clock } from 'lucide-react'
import type { RecentAvailabilitySession } from './types'
import { parseDeepLinkDetails, formatRelativeTime } from './utils'

interface Props {
  recentSessions: RecentAvailabilitySession[]
}

export function RecentAiRecommendationsFeed({ recentSessions }: Props) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-violet-600" />
            Recente AI-Aanbevelingen &amp; Deep-Link Bezoeken
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Live weergave van bezoekers die door een LLM direct naar een specifiek tijdslot zijn gestuurd.
          </p>
        </div>
        {recentSessions.length > 0 && (
          <span className="text-xs text-zinc-400">
            Laatste {recentSessions.length} deep links
          </span>
        )}
      </div>

      {recentSessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-xs text-zinc-500 space-y-2">
          <Info className="w-5 h-5 mx-auto text-zinc-400" />
          <p className="font-medium text-zinc-700">Nog geen specifieke tijdslot-clicks in deze periode</p>
          <p className="max-w-md mx-auto text-zinc-400">
            Zodra een gebruiker in ChatGPT of Perplexity vraagt naar bijv. &quot;Boottocht Amsterdam aanstaande zaterdag om 14:00&quot; en doorklikt op de link met parameters, zie je hier precies welke tocht en datum werden geciteerd.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recentSessions.map((s) => {
            const { cruiseSlug, date, time } = parseDeepLinkDetails(s.entry_page)

            return (
              <div
                key={s.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-zinc-100 bg-zinc-50/50 hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-violet-100 text-violet-800 flex-shrink-0">
                    {s.engine}
                  </span>
                  <div className="text-xs">
                    <div className="font-medium text-zinc-900 flex items-center gap-1.5 flex-wrap">
                      <span className="capitalize">{cruiseSlug.replace(/-/g, ' ')}</span>
                      {date && (
                        <span className="inline-flex items-center gap-1 bg-white border border-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded text-[11px]">
                          <Calendar className="w-3 h-3 text-zinc-400" />
                          {date}
                        </span>
                      )}
                      {time && (
                        <span className="inline-flex items-center gap-1 bg-white border border-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded text-[11px]">
                          <Clock className="w-3 h-3 text-zinc-400" />
                          {time}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 font-mono truncate max-w-xs sm:max-w-md block mt-0.5">
                      {s.entry_page}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 text-xs">
                  <span className="text-zinc-400 text-[11px]">
                    {formatRelativeTime(s.started_at)}
                  </span>
                  {s.booked ? (
                    <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full text-[11px]">
                      ✓ Geboekt (€{Math.round(s.revenueEuros)})
                    </span>
                  ) : (
                    <span className="text-zinc-400 text-[11px]">
                      Bekeken
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
