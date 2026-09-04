'use client'

import { useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'

interface Supplier {
  id: string
  name: string
}

/**
 * §6's manual-upload fallback — for a PDF that never arrived by email.
 * Files straight into the same "Handmatige facturen" inbox thread every
 * upload shares (see the upload route), so there's nothing new to build for
 * reviewing it: it's the same ContextPane "Factuur controleren" card every
 * emailed invoice gets. On success, jumps straight to that thread so Beer
 * sees the match/checks result immediately instead of having to go find it.
 */
export function UploadInvoiceModal({ onUploaded }: { onUploaded: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suppliers = useAdminFetch<Supplier[]>(open ? '/api/admin/finance/cockpit/suppliers' : null)

  function reset() {
    setFile(null)
    setSupplierId('')
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      if (supplierId) form.set('supplier_id', supplierId)
      const res = await fetch('/api/admin/finance/cockpit/invoices/upload', { method: 'POST', body: form })
      const json = await res.json().catch(() => null)
      if (!json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setOpen(false)
      reset()
      onUploaded(json.data.conversationId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uploaden mislukt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
      >
        <Upload className="w-3.5 h-3.5" /> Factuur uploaden
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              if (!busy) {
                setOpen(false)
                reset()
              }
            }}
          />
          <form onSubmit={submit} className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">Factuur uploaden</p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                disabled={busy}
                aria-label="Sluiten"
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Voor een factuur-PDF die niet via e-mail is binnengekomen. Verschijnt daarna in de inbox als een normale
              factuur-thread, met dezelfde controle als een geëmailde factuur.
            </p>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                required
                className="w-full text-xs text-zinc-600 file:mr-2 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-700 hover:file:bg-zinc-200"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Van wie (optioneel)</label>
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700"
              >
                <option value="">Onbekend — later koppelen</option>
                {(suppliers.data ?? []).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={!file || busy}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-2 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Uploaden
            </button>
          </form>
        </div>
      )}
    </>
  )
}
