'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import type { ImageAsset, ProcessingStep } from '@/lib/images/types'
import { formatBytes } from './format'

interface Props {
  asset: ImageAsset
  onProcessed: () => void
}

const LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'zh'] as const

const STEPS: { key: ProcessingStep; label: string }[] = [
  { key: 'download',    label: 'Download' },
  { key: 'sharp',       label: 'Sharp' },
  { key: 'ai_metadata', label: 'Gemini' },
  { key: 'translate',   label: 'Translate' },
  { key: 'upload',      label: 'Upload' },
  { key: 'save',        label: 'Save' },
]

function StepProgress({ currentStep, status, failureReason }: {
  currentStep: ProcessingStep | null
  status: ImageAsset['status']
  failureReason: string | null
}) {
  const currentIndex = currentStep ? STEPS.findIndex(s => s.key === currentStep) : -1
  const failed = status === 'failed'

  return (
    <div className="flex items-center gap-0.5 mt-1">
      {STEPS.map((s, i) => {
        const isDone    = !failed && currentIndex > i
        const isCurrent = currentIndex === i
        const isFailed  = failed && currentIndex === i
        const isPending = currentIndex < i && !(failed && currentIndex === i)

        return (
          <div key={s.key} className="flex items-center gap-0.5">
            {i > 0 && (
              <div className={`w-3 h-px ${isDone ? 'bg-emerald-400' : 'bg-zinc-200'}`} />
            )}
            <div
              title={isFailed ? `Failed at: ${s.label}${failureReason ? ` — ${failureReason}` : ''}` : s.label}
              className={[
                'relative flex items-center justify-center rounded-full text-[9px] font-bold select-none',
                'w-6 h-6 transition-all',
                isDone    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'  : '',
                isCurrent && !failed ? 'bg-blue-100 text-blue-700 border border-blue-400 ring-2 ring-blue-200' : '',
                isFailed  ? 'bg-red-100 text-red-700 border border-red-400'             : '',
                isPending && !isFailed ? 'bg-zinc-100 text-zinc-400 border border-zinc-200' : '',
              ].filter(Boolean).join(' ')}
            >
              {isDone ? '✓' : isCurrent && !failed ? (
                <span className="inline-block w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : isFailed ? '✕' : (i + 1)}
            </div>
          </div>
        )
      })}

      {/* Step label for current/failed step */}
      {currentStep && (
        <span className={`ml-1.5 text-[10px] font-medium ${failed ? 'text-red-600' : 'text-blue-600'}`}>
          {STEPS.find(s => s.key === currentStep)?.label}
          {failed ? ' failed' : '…'}
        </span>
      )}
    </div>
  )
}

export function AssetRow({ asset, onProcessed }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

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
  const altText = asset.alt_text as Record<string, string> | null | undefined
  const hasAltText = altText && Object.values(altText).some(v => v?.trim())

  const showStepProgress =
    (asset.status === 'processing' || asset.status === 'failed') && asset.processing_step !== null

  return (
    <>
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
          {hasAltText && altText?.en && (
            <div className="text-xs text-zinc-600 mt-0.5 max-w-[260px]">
              <span className="text-zinc-400 mr-1">en:</span>
              <span className="italic">{altText.en}</span>
            </div>
          )}
          {hasAltText && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 mt-0.5"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? 'Hide' : 'All languages'}
            </button>
          )}
          {asset.status === 'complete' && !hasAltText && (
            <span className="text-xs text-amber-600">No alt text — reprocess to generate</span>
          )}
        </td>

        <td className="px-3 py-2">
          <StatusBadge status={asset.status} />
          {showStepProgress && (
            <StepProgress
              currentStep={asset.processing_step}
              status={asset.status}
              failureReason={asset.failure_reason}
            />
          )}
        </td>

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
          {(error ?? asset.failure_reason) && !showStepProgress && (
            <div className="text-xs text-red-600 mb-1 max-w-[220px] break-words select-all cursor-text text-left">
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

      {expanded && hasAltText && (
        <tr className="bg-blue-50 border-b border-zinc-200">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {LOCALES.map(loc => {
                const text = altText?.[loc]
                if (!text) return null
                return (
                  <div key={loc} className="text-xs">
                    <span className="font-semibold text-zinc-500 uppercase mr-1">{loc}</span>
                    <span className="text-zinc-800 select-all">{text}</span>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
