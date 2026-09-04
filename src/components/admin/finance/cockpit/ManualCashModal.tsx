'use client'

import { useEffect, useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { COCKPIT_API, type SettingsRow } from './api-types'
import { MoneyField } from './MoneyField'
import { eurosToCents, centsToEuros, dateTimeNL } from './money'
import { settingsPayloadFrom } from './SettingsModal'

interface ManualCashModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  settings: SettingsRow | null
}

/**
 * "Saldo invoeren" — the stopgap until Revolut is connected (phase 2).
 * Writes manual_cash_cents; the API stamps manual_cash_at.
 */
export function ManualCashModal({ open, onClose, onSaved, settings }: ManualCashModalProps) {
  const { saving, error, setError, run } = useAdminSave()
  const [amount, setAmount] = useState('')

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount(centsToEuros(settings?.manual_cash_cents ?? null))
    setError(null)
  }, [open, settings, setError])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    const cents = eurosToCents(amount)
    if (cents == null) { setError('Vul het huidige saldo in.'); return }
    run(async () => {
      await adminMutate(`${COCKPIT_API}/settings`, 'PUT', settingsPayloadFrom(settings, { manual_cash_cents: cents }))
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title="Saldo invoeren"
      subtitle={settings?.manual_cash_at ? `Laatst ingevoerd op ${dateTimeNL(settings.manual_cash_at)}.` : 'Het vrij beschikbare saldo op de Revolut EUR-rekening.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel="Opslaan"
      submitDisabled={!settings}
      maxWidthClass="max-w-sm"
    >
      <MoneyField label="Huidig saldo" value={amount} onChange={setAmount} required hint="Alleen het geboekte saldo — niet wat nog in behandeling is." />
    </AdminFormModal>
  )
}
