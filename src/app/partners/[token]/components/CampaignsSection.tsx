'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'

interface CampaignCard {
  id: string
  name: string
  slug: string
  trackingUrl: string
  sessions: number
  bookings: number
  revenueCents: number
  commissionCents: number
}

export function CampaignsSection({ campaigns }: { campaigns: CampaignCard[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Active campaigns</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Last 30 days. Share the tracking URL — every visit is attributed to you.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {campaigns.map(c => <CampaignTile key={c.id} c={c} />)}
      </div>
    </section>
  )
}

function CampaignTile({ c }: { c: CampaignCard }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(c.trackingUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div>
        <p className="font-semibold text-zinc-900">{c.name}</p>
        <p className="text-xs text-zinc-500 font-mono">/t/{c.slug}</p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 truncate text-xs bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5 font-mono text-zinc-700">
          {c.trackingUrl}
        </code>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-zinc-900 text-white rounded-lg hover:bg-zinc-700"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 pt-2 border-t border-zinc-100">
        <Stat label="Sessions" value={c.sessions.toString()} />
        <Stat label="Bookings" value={c.bookings.toString()} />
        <Stat label="Revenue" value={fmtEuros(c.revenueCents)} />
        <Stat label="Earned" value={fmtEuros(c.commissionCents)} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="text-sm font-semibold text-zinc-900 mt-0.5">{value}</p>
    </div>
  )
}
