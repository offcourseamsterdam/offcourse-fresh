'use client'

import Link from 'next/link'
import { Clock, CheckCircle2, ShieldCheck, Zap, ExternalLink } from 'lucide-react'
import type { AvailabilitySyncStatus } from './types'
import { formatRelativeTime } from './utils'

interface Props {
  syncStatus: AvailabilitySyncStatus | undefined
  isLoading: boolean
}

export function AvailabilitySyncCard({ syncStatus, isLoading }: Props) {
  return (
    <div className="bg-gradient-to-r from-violet-900/5 via-fuchsia-900/5 to-transparent rounded-2xl border border-violet-100 p-5 sm:p-6 bg-white shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Live AI Index &amp; Availability Engine
            </span>
          </div>
          <h2 className="text-base font-semibold text-zinc-900">
            FareHarbor Real-Time Availability Snapshots
          </h2>
          <p className="text-xs text-zinc-600 max-w-2xl leading-relaxed">
            Elke tocht (zowel privé als shared en alle virtual listings zoals de Amsterdam Light Festival &amp; Jamaican Buffet cruises) wordt elke ochtend en 3x per dag gesynchroniseerd. AI-crawlers en LLMs lezen de beschikbare tijdsloten direct uit de statische HTML en Schema.org JSON-LD.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-t lg:border-t-0 lg:border-l border-zinc-100 pt-4 lg:pt-0 lg:pl-6 text-xs">
          <div>
            <span className="text-zinc-400 block text-[11px]">Laatste sync</span>
            <span className="font-semibold text-zinc-800 flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              {isLoading ? 'Laden...' : formatRelativeTime(syncStatus?.latestSnapshotAt ?? null)}
            </span>
          </div>
          <div>
            <span className="text-zinc-400 block text-[11px]">Actieve snapshots</span>
            <span className="font-semibold text-zinc-800 flex items-center gap-1.5 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              {syncStatus?.count ?? 0} listings up-to-date
            </span>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <span className="text-zinc-400 block text-[11px]">Frequentie</span>
            <span className="font-medium text-zinc-700 mt-0.5 block">
              3x / dag (07, 13, 19u) + direct
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 text-zinc-600">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            14-dagen vooruitblik
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-500" />
            Directe Next.js Cache Purge bij wijzigingen
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-violet-700 font-medium hover:text-violet-800 transition-colors"
          >
            Bekijk /llms.txt manifest
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <span className="text-zinc-300">·</span>
          <Link
            href="/en/cruises"
            target="_blank"
            className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            Controleer Schema.org HTML
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
