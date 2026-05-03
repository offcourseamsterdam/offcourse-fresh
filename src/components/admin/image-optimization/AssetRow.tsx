'use client'

import { useState } from 'react'
import { StatusBadge } from './StatusBadge'
import type { ImageAsset } from '@/lib/images/types'
import { formatBytes } from './format'

interface Props {
  asset: ImageAsset
  onProcessed: () => void
}

export function AssetRow({ asset, onProcessed }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleProcess = async (action: 'process' | 'reprocess' | 'reset') => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/images/${asset.id}/${action}`, { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      onProcessed()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed')
    } finally {
      setBusy(false)
    }
  }

  const totalProcessedBytes =
    asset.variants?.reduce((sum, v) => sum + (v.avif_size ?? 0) + (v.webp_size ?? 0), 0) ?? 0

  const previewUrl = asset.variants?.find(v => v.width === 320)?.webp_url ?? asset.original_url

  return (
    <tr className="border-b border-zinc-200 hover:bg-zinc-50">
      <td className="px-3 py-2">
        <div
          className="w-16 h-12 bg-zinc-100 rounded overflow-hidden"
          style={{ backgroundColor: asset.dominant_color ?? undefined }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      </td>

      <td className="px-3 py-2 text-sm">
        <div className="font-mono text-xs text-zinc-700 truncate max-w-[260px]">
          {asset.base_filename ?? asset.id.slice(0, 8) + '…'}
        </div>
        <div className="text-xs text-zinc-500">{asset.context} {asset.context_id ? `· ${asset.context_id.slice(0, 8)}` : ''}</div>
      </td>

      <td className="px-3 py-2"><StatusBadge status={asset.status} /></td>

      <td className="px-3 py-2 text-xs text-zinc-700">
        {asset.status === 'complete' && totalProcessedBytes > 0 ? (
          <div>
            <div>{formatBytes(totalProcessedBytes)}</div>
            <div className="text-zinc-500">{asset.variants?.length ?? 0} variants</div>
          </div>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>

      <td className="px-3 py-2">
        {asset.dominant_color && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded border border-zinc-300" style={{ backgroundColor: asset.dominant_color }} />
            <span className="text-xs font-mono text-zinc-600">{asset.dominant_color}</span>
          </div>
        )}
      </td>

      <td className="px-3 py-2">
        {asset.quality_issues && asset.quality_issues.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {asset.quality_issues.map(q => (
              <span key={q} className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                {q.replace('_', ' ')}
              </span>
            ))}
          </div>
        ) : asset.status === 'complete' ? (
          <span className="text-xs text-emerald-600">✓ Good</span>
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        )}
      </td>

      <td className="px-3 py-2 text-right">
        {(error ?? asset.failure_reason) && (
          <div className="text-xs text-red-600 mb-1 truncate max-w-[200px]" title={error ?? asset.failure_reason ?? undefined}>
            {error ?? asset.failure_reason}
          </div>
        )}
        {asset.status === 'pending' || asset.status === 'failed' ? (
          <button
            disabled={busy}
            onClick={() => handleProcess('process')}
            className="text-sm font-medium px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Processing…' : 'Process'}
          </button>
        ) : asset.status === 'complete' ? (
          <button
            disabled={busy}
            onClick={() => handleProcess('reprocess')}
            className="text-sm font-medium px-3 py-1 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Re-process'}
          </button>
        ) : asset.status === 'processing' ? (
          <button
            disabled={busy}
            onClick={() => handleProcess('reset')}
            className="text-sm font-medium px-3 py-1 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {busy ? 'Resetting…' : 'Reset'}
          </button>
        ) : null}
      </td>
    </tr>
  )
}
