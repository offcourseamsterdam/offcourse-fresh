'use client'

import { Sparkles, Loader2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { AiReferralRow } from '@/lib/tracking/ai-referrers'

interface AiReferralsData {
  engines: AiReferralRow[]
  totalSessions: number
  totalBookings: number
  totalRevenueEuros: number
  demo?: boolean
}

export function AiReferralsSection({ from, to }: { from: string; to: string }) {
  const demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1'
  const { data, isLoading } = useAdminFetch<AiReferralsData>(
    `/api/admin/tracking/ai-referrals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${demo ? '&demo=1' : ''}`,
  )
  const engines = data?.engines ?? []
  const hasTraffic = engines.length > 0

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" />
          AI Referrals
          {data?.demo && (
            <span className="text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              Demo
            </span>
          )}
        </h2>
        {hasTraffic && (
          <span className="text-xs text-zinc-400 tabular-nums">
            {data?.totalSessions} visits · {data?.totalBookings} booked · €{Math.round(data?.totalRevenueEuros ?? 0)}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mt-1 mb-4">
        When ChatGPT, Perplexity, Gemini &amp; co. cite Off Course and send someone over.
      </p>

      {isLoading && !data && (
        <div className="flex justify-center py-6 text-zinc-300"><Loader2 className="w-5 h-5 animate-spin" /></div>
      )}

      {!isLoading && !hasTraffic && (
        <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
          No AI traffic yet — we’ll catch it the moment an AI assistant starts citing you.
        </div>
      )}

      {hasTraffic && (
        <div className="space-y-1.5">
          {engines.map(e => (
            <div key={e.key} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-zinc-50">
              <span className="text-sm font-medium text-zinc-800 flex-shrink-0">{e.label}</span>
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs tabular-nums text-zinc-500">
                <span><b className="text-zinc-900">{e.sessions}</b> visits</span>
                <span className="hidden sm:inline"><b className="text-zinc-900">{e.visitors}</b> visitors</span>
                <span><b className="text-zinc-900">{e.bookings}</b> booked</span>
                <span className="text-emerald-600 font-medium">€{Math.round(e.revenueEuros)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-zinc-400 mt-3">
        Note: Google’s AI Overviews show up as normal Google traffic, so they can’t be split out here.
      </p>
    </div>
  )
}
