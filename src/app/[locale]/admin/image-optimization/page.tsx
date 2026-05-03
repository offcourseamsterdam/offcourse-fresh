'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, Zap, Database } from 'lucide-react'
import { AssetRow } from '@/components/admin/image-optimization/AssetRow'
import type { ImageListResponse } from '@/components/admin/image-optimization/types'
import type { ImageAssetStatus } from '@/lib/images/types'

type Filter = 'all' | ImageAssetStatus

export default function ImageOptimizationPage() {
  const [data, setData] = useState<ImageListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<string | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [migrateMessage, setMigrateMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      const res = await fetch(`/api/admin/images/list?${params}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setData(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { refresh() }, [refresh])

  const processAllPending = async () => {
    if (!data || data.counts.pending === 0) return
    setBatchRunning(true)
    setBatchProgress(`Processing ${data.counts.pending} pending images…`)
    try {
      const res = await fetch('/api/admin/images/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending', limit: data.counts.pending }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setBatchProgress(`Done — ${json.data.succeeded} succeeded, ${json.data.failed} failed`)
      await refresh()
    } catch (e) {
      setBatchProgress(`Error: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setBatchRunning(false)
      setTimeout(() => setBatchProgress(null), 5000)
    }
  }

  const migrateLegacy = async () => {
    setMigrating(true)
    setMigrateMessage('Scanning all existing images…')
    try {
      const res = await fetch('/api/admin/images/migrate-legacy', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      const { scanned, created, linked, errors } = json.data
      setMigrateMessage(
        `Scanned ${scanned} images — created ${created} new asset records, linked ${linked} duplicates, ${errors} errors. Click "Process all pending" to optimise them.`,
      )
      await refresh()
    } catch (e) {
      setMigrateMessage(`Error: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setMigrating(false)
    }
  }

  const counts = data?.counts ?? { pending: 0, processing: 0, complete: 0, failed: 0, total: 0 }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Image Optimization</h1>
          <p className="text-sm text-zinc-600 mt-1">
            Pipeline: Sharp → Gemini Vision → Claude translation. Generates AVIF + WebP variants
            at 6 widths, dominant-color background, blur placeholder, and AI-generated alt text in 7 languages.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </header>

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <CountCard label="Pending"    value={counts.pending}    color="amber"  />
        <CountCard label="Processing" value={counts.processing} color="blue"   />
        <CountCard label="Complete"   value={counts.complete}   color="emerald"/>
        <CountCard label="Failed"     value={counts.failed}     color="red"    />
      </div>

      {/* Batch controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <button
          onClick={processAllPending}
          disabled={batchRunning || counts.pending === 0}
          className="flex items-center gap-2 px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {batchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Process all pending ({counts.pending})
        </button>
        <button
          onClick={migrateLegacy}
          disabled={migrating}
          className="flex items-center gap-2 px-4 py-2 rounded border border-zinc-300 text-zinc-800 font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {migrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          Scan legacy images
        </button>
      </div>

      {(batchProgress || migrateMessage) && (
        <div className="mb-4 p-3 rounded bg-blue-50 border border-blue-200 text-sm text-blue-900">
          {batchProgress ?? migrateMessage}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3 border-b border-zinc-200">
        {(['all', 'pending', 'processing', 'complete', 'failed'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filter === f
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && ` (${counts[f]})`}
          </button>
        ))}
      </div>

      {/* Asset table */}
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">{error}</div>}

      {!error && data && data.assets.length === 0 && (
        <div className="p-8 text-center text-zinc-500 border border-dashed border-zinc-300 rounded">
          No images yet. Upload via the Cruises, Extras, or Homepage admin pages — or click <em>Scan legacy images</em> to import what&apos;s already on the site.
        </div>
      )}

      {!error && data && data.assets.length > 0 && (
        <div className="overflow-x-auto border border-zinc-200 rounded-lg bg-white">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr className="text-left text-xs font-semibold text-zinc-600 uppercase tracking-wide">
                <th className="px-3 py-2 w-20">Preview</th>
                <th className="px-3 py-2">Filename</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Color</th>
                <th className="px-3 py-2">Quality</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map(asset => (
                <AssetRow key={asset.id} asset={asset} onProcessed={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CountCard({ label, value, color }: { label: string; value: number; color: 'amber' | 'blue' | 'emerald' | 'red' }) {
  const styles = {
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    blue: 'bg-blue-50 text-blue-900 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    red: 'bg-red-50 text-red-900 border-red-200',
  }[color]
  return (
    <div className={`rounded-lg border p-3 ${styles}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  )
}
