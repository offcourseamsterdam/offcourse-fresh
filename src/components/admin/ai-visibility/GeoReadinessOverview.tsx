'use client'

import { ShieldCheck } from 'lucide-react'

const PILLARS = [
  {
    title: '1. Live HTML Departures',
    status: 'Actief',
    description:
      'Volledig gerenderd in SSR HTML. AI-bots zonder JavaScript kunnen tijden, prijzen en capaciteit direct parsen.',
  },
  {
    title: '2. Schema.org JSON-LD',
    status: 'Actief',
    description:
      'Gestructureerde Event & TouristTrip metadata met specifieke url deep links inclusief datum & tijd.',
  },
  {
    title: '3. /llms.txt Manifest',
    status: 'Actief',
    description:
      'Machine-readable overzicht voor LLMs met directe links en beschrijvingen van privé- en shared vaartochten.',
  },
  {
    title: '4. 3x Daagse Cron & Webhooks',
    status: 'Actief',
    description:
      'Geautomatiseerde synchronisatie via Vercel Cron (07:00, 13:00, 19:00) en directe Next.js cache purging.',
  },
]

export function GeoReadinessOverview() {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        GEO (Generative Engine Optimization) Architectuur &amp; Status
      </h2>
      <p className="text-xs text-zinc-500 mb-4">
        Overzicht van de maatregelen waarmee zoekmachines en AI-assistenten onze tochten accuraat kunnen indexeren.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        {PILLARS.map((pillar) => (
          <div key={pillar.title} className="p-3.5 rounded-lg border border-zinc-100 bg-zinc-50/60">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-zinc-800">{pillar.title}</span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                {pillar.status}
              </span>
            </div>
            <p className="text-zinc-500 text-[11px] leading-relaxed">{pillar.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
