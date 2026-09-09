'use client'

import { Bot, Sparkles, Link as LinkIcon, TrendingUp } from 'lucide-react'
import type { AiReferralsData } from './types'

interface Props {
  data: AiReferralsData | undefined
  isLoading: boolean
}

export function AiMetricsCards({ data, isLoading }: Props) {
  const totalSessions = data?.totalSessions ?? 0
  const totalAvailability = data?.totalAvailabilitySessions ?? 0
  const totalBookings = data?.totalBookings ?? 0
  const totalRevenue = data?.totalRevenueEuros ?? 0
  const availPercent = totalSessions > 0 ? Math.round((totalAvailability / totalSessions) * 100) : 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total AI Visits */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">Totale AI Bezoeken</span>
          <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600">
            <Bot className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold text-zinc-900 tabular-nums">
            {isLoading ? '...' : totalSessions}
          </span>
          <p className="text-xs text-zinc-500 mt-1">
            {isLoading ? 'Laden...' : 'Citaties via ChatGPT, Perplexity e.a.'}
          </p>
        </div>
      </div>

      {/* AI Availability Deep Links */}
      <div className="bg-white rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/30 to-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-violet-900 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-violet-600" />
            AI Beschikbaarheids-Links
          </span>
          <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
            <LinkIcon className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-violet-900 tabular-nums">
              {isLoading ? '...' : totalAvailability}
            </span>
            <span className="text-xs font-semibold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
              {availPercent}% van AI
            </span>
          </div>
          <p className="text-xs text-zinc-600 mt-1">
            Bezoeken direct op een datum &amp; tijdslot (<code className="text-[10px] bg-zinc-100 px-1 py-0.5 rounded">?date=</code>)
          </p>
        </div>
      </div>

      {/* AI Bookings */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">AI Boekingen</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold text-zinc-900 tabular-nums">
            {isLoading ? '...' : totalBookings}
          </span>
          <p className="text-xs text-zinc-500 mt-1">
            Waarvan <b className="text-zinc-700">{data?.totalAvailabilityBookings ?? 0}</b> via beschikbaarheidslink
          </p>
        </div>
      </div>

      {/* AI Revenue */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">AI Omzet</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 font-semibold text-sm">
            €
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold text-emerald-600 tabular-nums">
            €{isLoading ? '...' : Math.round(totalRevenue)}
          </span>
          <p className="text-xs text-zinc-500 mt-1">
            Waarvan €{Math.round(data?.totalAvailabilityRevenueEuros ?? 0)} via beschikbaarheidslinks
          </p>
        </div>
      </div>
    </div>
  )
}
