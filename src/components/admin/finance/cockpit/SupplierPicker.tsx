'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { adminInputClass } from '@/components/admin/ui/fields'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate, AdminApiError } from '@/hooks/useAdminSave'
import { COCKPIT_API } from './api-types'

export interface SupplierOption {
  id: string
  name: string
  staff_id: string | null
  has_iban: boolean
}

interface SupplierPickerProps {
  value: string | null
  onChange: (supplierId: string) => void
  /** Rendered instead of the select while a supplier hasn't been chosen at all. */
  emptyLabel?: string
}

/**
 * Pick an existing payee (for payment drafting) or add a new one inline — one IBAN, validated
 * server-side (mod-97) before the row exists, then reported back via onChange. Shared by
 * ObligationModal and ExpenseDrawer; used wherever "Concept-betaling klaarzetten" needs a payee.
 */
export function SupplierPicker({ value, onChange, emptyLabel = '— geen leverancier —' }: SupplierPickerProps) {
  const { data: suppliers, mutate } = useAdminFetch<SupplierOption[]>(`${COCKPIT_API}/suppliers`)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [iban, setIban] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = (suppliers ?? []).find(s => s.id === value) ?? null

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !iban.trim()) return
    setSaving(true)
    setError(null)
    try {
      const created = await adminMutate<SupplierOption>(`${COCKPIT_API}/suppliers`, 'POST', { name: name.trim(), iban: iban.trim() })
      void mutate(prev => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)), { revalidate: false })
      onChange(created.id)
      setAdding(false)
      setName('')
      setIban('')
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Kon leverancier niet aanmaken.')
    } finally {
      setSaving(false)
    }
  }

  if (adding) {
    return (
      <form onSubmit={handleAdd} className="space-y-2 rounded-lg border border-dashed border-zinc-300 p-3">
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">Naam</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="bijv. Jachthaven Westerdok" className={`${adminInputClass} min-h-[44px] sm:min-h-0`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">IBAN</span>
          <input value={iban} onChange={e => setIban(e.target.value)} placeholder="NL91 ABNA 0417 1643 00" className={`${adminInputClass} min-h-[44px] sm:min-h-0`} />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !name.trim() || !iban.trim()} className="min-h-[44px] sm:min-h-0">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Aanmaken en koppelen
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} className="min-h-[44px] sm:min-h-0">Annuleer</Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ''}
        onChange={e => e.target.value && onChange(e.target.value)}
        className={`${adminInputClass} min-h-[44px] sm:min-h-0 flex-1`}
      >
        <option value="">{emptyLabel}</option>
        {(suppliers ?? []).map(s => (
          <option key={s.id} value={s.id}>{s.name}{s.has_iban ? '' : ' (geen IBAN)'}</option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} className="min-h-[44px] sm:min-h-0 shrink-0" aria-label="Nieuwe leverancier">
        <Plus className="w-3.5 h-3.5" />
      </Button>
      {selected && !selected.has_iban && <p className="text-xs text-amber-700 shrink-0">Geen IBAN — betaling kan nog niet klaargezet worden.</p>}
    </div>
  )
}
