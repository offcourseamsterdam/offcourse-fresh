'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { CruiseTabProps } from './shared'
import {
  formatTierLines,
  normalizeTiers,
} from '@/lib/cancellation/policy'
import { useAdminFetch } from '@/hooks/useAdminFetch'

interface FHItemRow {
  fareharbor_pk: number
  name: string
  cancellation_tiers: unknown
}

/**
 * Read-only view of the cancellation policy inherited from the parent
 * FareHarbor item. The actual editor lives at /admin/fareharbor-settings —
 * we surface a link there so a single edit propagates to all virtual listings.
 */
export function CruiseCancellationTab({ listing }: CruiseTabProps) {
  const { data, isLoading: loading } = useAdminFetch<{ items: FHItemRow[] }>('/api/admin/fareharbor-items')
  const item = useMemo(
    () => data?.items?.find(i => i.fareharbor_pk === listing.fareharbor_item_pk) ?? null,
    [data, listing.fareharbor_item_pk]
  )
  const tiers = useMemo(() => normalizeTiers(item?.cancellation_tiers), [item])
  const fhItemName = item?.name ?? null

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    )
  }

  const lines = tiers ? formatTierLines(tiers) : []

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <p className="text-xs font-medium text-zinc-600 mb-1">Cancellation policy</p>
        <p className="text-xs text-zinc-400">
          Inherited from FareHarbor item
          {fhItemName ? <strong className="text-zinc-700"> {fhItemName}</strong> : ''}.
          Edit it once and every linked cruise listing updates automatically.
        </p>
      </div>

      <ul className="space-y-2 bg-zinc-50 rounded-lg p-4 border border-zinc-100">
        {lines.map((line) => (
          <li key={line.label} className="flex items-start gap-3">
            <span
              className={`mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                line.refundPercent === 100
                  ? 'bg-emerald-500'
                  : line.refundPercent === 0
                  ? 'bg-zinc-300'
                  : 'bg-amber-500'
              }`}
            />
            <div className="text-sm">
              <span className="font-medium text-zinc-900">{line.label}</span>
              <span className="text-zinc-500"> · {line.detail}</span>
            </div>
          </li>
        ))}
      </ul>

      <Link
        href="/admin/fareharbor-settings"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        Edit on FareHarbor settings
        <ExternalLink className="w-3.5 h-3.5" />
      </Link>
    </div>
  )
}
