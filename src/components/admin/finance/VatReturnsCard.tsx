'use client'

import { useState } from 'react'
import { Loader2, Plus, FileText, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, SelectField, TextField, adminInputClass } from '@/components/admin/ui/fields'
import { MoneyField } from '@/components/admin/finance/cockpit/MoneyField'
import { eur, eurosToCents } from '@/components/admin/finance/cockpit/money'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminDate } from '@/lib/admin/format'

const QUARTER_RE = /^\d{4}-Q[1-4]$/

interface VatReturnRow {
  id: string
  quarter: string
  filed_date: string
  net_cents: number
  vat9_owed_cents: number | null
  vat21_owed_cents: number | null
  voorbelasting_cents: number | null
  original_filename: string | null
  notes: string | null
  obligation_id: string | null
  created_at: string
}

/**
 * The archive of BTW-aangiftes actually filed by the accountant — distinct from the
 * computed indication in the tables below. Beer, 2026-09-10: "Komende verplichtingen"
 * was showing a wrong estimate for a quarter that was already filed (and turned out to
 * be a refund); uploading the real aangifte here closes that obligation with the real
 * figure so it never happens silently again.
 */
export function VatReturnsCard({ quarterOptions }: { quarterOptions: string[] }) {
  const { data, isLoading, refresh } = useAdminFetch<VatReturnRow[]>('/api/admin/finance/vat-returns')
  const [formOpen, setFormOpen] = useState(false)

  const rows = data ?? []

  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Ingediende aangiftes</h3>
          <p className="text-xs text-zinc-500 mt-0.5">De werkelijke aangifte van de boekhouder, niet de berekende indicatie hieronder.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setFormOpen(o => !o)} className="min-h-[44px] sm:min-h-0">
          <Plus className="w-3.5 h-3.5" /> Aangifte toevoegen
        </Button>
      </div>

      {formOpen && (
        <VatReturnForm
          quarterOptions={quarterOptions}
          onDone={() => {
            setFormOpen(false)
            refresh()
          }}
        />
      )}

      {isLoading && rows.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-6 px-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Laden…
        </div>
      )}

      {!isLoading && rows.length === 0 && !formOpen && (
        <p className="text-sm text-zinc-400 py-6 px-4 text-center">Nog geen aangiftes geüpload.</p>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-zinc-100">
          {rows.map(r => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">{r.quarter}</p>
                <p className="text-xs text-zinc-500">Verzonden {fmtAdminDate(r.filed_date)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={r.net_cents < 0 ? 'text-emerald-700 font-semibold' : r.net_cents > 0 ? 'text-red-700 font-semibold' : 'text-zinc-500'}>
                  {r.net_cents === 0 ? 'nihil' : `${eur(Math.abs(r.net_cents))} ${r.net_cents < 0 ? 'terug' : 'verschuldigd'}`}
                </span>
                <a
                  href={`/api/admin/finance/attachments/vat_return/${r.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 text-zinc-400 hover:text-zinc-700 sm:min-h-0 sm:min-w-0"
                  title={r.original_filename ?? 'Download'}
                >
                  <FileText className="w-4 h-4" />
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VatReturnForm({ quarterOptions, onDone }: { quarterOptions: string[]; onDone: () => void }) {
  const [quarter, setQuarter] = useState(quarterOptions[0] ?? '')
  const [filedDate, setFiledDate] = useState('')
  const [direction, setDirection] = useState<'owed' | 'refund'>('refund')
  const [amount, setAmount] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!file) return setError('Kies eerst de PDF van de aangifte.')
    const amountCents = eurosToCents(amount)
    if (amountCents === null || amountCents < 0) return setError('Vul een geldig bedrag in.')
    if (!QUARTER_RE.test(quarter)) return setError('Kies een kwartaal, bijv. 2026-Q1.')
    if (!filedDate) return setError('Vul de verzenddatum in.')

    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('quarter', quarter)
      form.set('filedDate', filedDate)
      form.set('direction', direction)
      form.set('amountCents', String(amountCents))

      const res = await fetch('/api/admin/finance/vat-returns', { method: 'POST', body: form })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uploaden mislukt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <TextField label="Kwartaal" value={quarter} onChange={e => setQuarter(e.target.value)} placeholder="2026-Q1" />
        <TextField label="Verzenddatum" type="date" value={filedDate} onChange={e => setFiledDate(e.target.value)} />
        <SelectField label="Resultaat" value={direction} onChange={e => setDirection(e.target.value as 'owed' | 'refund')}>
          <option value="refund">Terug te ontvangen</option>
          <option value="owed">Verschuldigd</option>
        </SelectField>
        <MoneyField label="Bedrag" value={amount} onChange={setAmount} placeholder="34855" />
      </div>
      <Field label="PDF van de aangifte">
        <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className={`${adminInputClass} py-1.5`} />
      </Field>
      <Button size="sm" onClick={submit} disabled={busy} className="min-h-[44px] sm:min-h-0">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Opslaan
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-zinc-400">Sluit meteen de bijbehorende &quot;Komende verplichtingen&quot;-post af met dit echte bedrag.</p>
    </div>
  )
}
