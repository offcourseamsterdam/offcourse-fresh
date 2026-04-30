'use client'

import { Button } from '@/components/ui/button'
import { Loader2, RotateCcw } from 'lucide-react'
import type { AdminPromoCode } from '@/lib/admin/types'

export interface FormState {
  label: string
  code: string
  discount_type: 'percentage' | 'fixed_amount' | 'full'
  discount_value: string
  fixed_discount_euros: string
  max_uses: string
  valid_from: string
  valid_until: string
  notes: string
}

export function blankForm(): FormState {
  return {
    label: '',
    code: '',
    discount_type: 'percentage',
    discount_value: '',
    fixed_discount_euros: '',
    max_uses: '100',
    valid_from: '',
    valid_until: '',
    notes: '',
  }
}

interface PromoCodeFormModalProps {
  editingCode: AdminPromoCode | null
  form: FormState
  onChange: (f: FormState) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
  saveError: string | null
}

export function PromoCodeFormModal({
  editingCode,
  form,
  onChange,
  onSave,
  onClose,
  saving,
  saveError,
}: PromoCodeFormModalProps) {
  function set(key: keyof FormState, value: string) {
    onChange({ ...form, [key]: value })
  }

  const isEdit = !!editingCode

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
        <h2 className="text-base font-semibold text-zinc-900">
          {isEdit ? 'Edit Promo Code' : 'New Promo Code'}
        </h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">&times;</button>
      </div>

      <div className="px-6 py-5 space-y-4">

        {/* Label */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Label <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.label}
            onChange={e => set('label', e.target.value)}
            placeholder="e.g. Partner — Booking.com"
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
        </div>

        {/* Code */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">
            Code
            <span className="ml-1 text-zinc-400 font-normal">(leave blank to auto-generate)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={form.code}
              onChange={e => set('code', e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              className="flex-1 text-sm font-mono border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
            {isEdit && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 border border-zinc-200 rounded-lg px-3 py-2"
                onClick={() => set('code', '')}
                title="Clear to auto-generate a new code"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Rotate
              </button>
            )}
          </div>
        </div>

        {/* Discount type */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Discount type <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            {(['percentage', 'fixed_amount', 'full'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => set('discount_type', t)}
                className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                  form.discount_type === t
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                }`}
              >
                {t === 'percentage' ? '% Off' : t === 'fixed_amount' ? '€ Off' : 'Free'}
              </button>
            ))}
          </div>
        </div>

        {/* Discount value */}
        {form.discount_type === 'percentage' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Percentage off <span className="text-red-500">*</span></label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                value={form.discount_value}
                onChange={e => set('discount_value', e.target.value)}
                placeholder="e.g. 20"
                className="w-32 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
              <span className="text-sm text-zinc-500">%</span>
            </div>
          </div>
        )}

        {form.discount_type === 'fixed_amount' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Amount off <span className="text-red-500">*</span></label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">€</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.fixed_discount_euros}
                onChange={e => set('fixed_discount_euros', e.target.value)}
                placeholder="e.g. 25.00"
                className="w-32 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
            </div>
          </div>
        )}

        {form.discount_type === 'full' && (
          <p className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            Full discount — booking is free, bypasses Stripe entirely. Use for partner redemptions.
          </p>
        )}

        {/* Max uses */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">
            Max uses
            <span className="ml-1 text-zinc-400 font-normal">(auto-rotates when reached)</span>
          </label>
          <input
            type="number"
            min="1"
            value={form.max_uses}
            onChange={e => set('max_uses', e.target.value)}
            placeholder="e.g. 100"
            className="w-32 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
        </div>

        {/* Validity dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Valid from</label>
            <input
              type="date"
              value={form.valid_from}
              onChange={e => set('valid_from', e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Valid until</label>
            <input
              type="date"
              value={form.valid_until}
              onChange={e => set('valid_until', e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="e.g. Used for Booking.com partner agreement Q2 2026"
            rows={2}
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-none"
          />
        </div>

        {saveError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {saveError}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-100">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {isEdit ? 'Save changes' : 'Create code'}
        </Button>
      </div>
    </div>
  )
}
