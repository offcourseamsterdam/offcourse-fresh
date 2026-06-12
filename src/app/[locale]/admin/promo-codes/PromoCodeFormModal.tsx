'use client'

import { RotateCcw } from 'lucide-react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, TextAreaField, SelectField, Field, adminInputClass } from '@/components/admin/ui/fields'
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
  /** Empty string = global (no scope). Otherwise the campaign UUID to lock to. */
  campaign_id: string
  /** 'cruise' = base + city tax only (extras pay full); 'all' = grand total incl. extras. */
  discount_scope: 'cruise' | 'all'
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
    campaign_id: '',
    discount_scope: 'cruise',
  }
}

export interface CampaignOption {
  id: string
  name: string
  /** Listing this campaign points to (or null = Homepage). Shown in UI for context. */
  listing_title: string | null
  /** Partner this campaign is for (null = direct). */
  partner_name: string | null
}

interface PromoCodeFormModalProps {
  editingCode: AdminPromoCode | null
  form: FormState
  onChange: (f: FormState) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
  saveError: string | null
  /** List of campaigns to choose from for code scoping. */
  campaigns: CampaignOption[]
}

export function PromoCodeFormModal({
  editingCode,
  form,
  onChange,
  onSave,
  onClose,
  saving,
  saveError,
  campaigns,
}: PromoCodeFormModalProps) {
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    onChange({ ...form, [key]: value })
  }

  const isEdit = !!editingCode

  return (
    <AdminFormModal
      title={isEdit ? 'Edit Promo Code' : 'New Promo Code'}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave() }}
      saving={saving}
      error={saveError}
      submitLabel={isEdit ? 'Save changes' : 'Create code'}
      maxWidthClass="max-w-lg"
    >
      <TextField
        label="Label *"
        type="text"
        value={form.label}
        onChange={e => set('label', e.target.value)}
        placeholder="e.g. Partner — Booking.com"
      />

      <Field label="Code" hint="Leave blank to auto-generate">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={form.code}
            onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="XXXX"
            className={`${adminInputClass} flex-1 font-mono`}
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
      </Field>

      <Field label="Discount type *">
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
      </Field>

      <Field
        label="Discount applies to"
        hint={form.discount_scope === 'cruise'
          ? 'Discount covers cruise price + city tax. Extras (food, drinks) charged separately at full price.'
          : 'Discount applies to the entire booking total including extras.'}
      >
        <div className="flex gap-2">
          {(['cruise', 'all'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => set('discount_scope', s)}
              className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                form.discount_scope === s
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              {s === 'cruise' ? 'Cruise only (excl. extras)' : 'Everything (incl. extras)'}
            </button>
          ))}
        </div>
      </Field>

      {form.discount_type === 'percentage' && (
        <Field label="Percentage off *">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="100"
              value={form.discount_value}
              onChange={e => set('discount_value', e.target.value)}
              placeholder="e.g. 20"
              className={`${adminInputClass} w-32`}
            />
            <span className="text-sm text-zinc-500">%</span>
          </div>
        </Field>
      )}

      {form.discount_type === 'fixed_amount' && (
        <Field label="Amount off *">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">€</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.fixed_discount_euros}
              onChange={e => set('fixed_discount_euros', e.target.value)}
              placeholder="e.g. 25.00"
              className={`${adminInputClass} w-32`}
            />
          </div>
        </Field>
      )}

      {form.discount_type === 'full' && (
        <p className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          {form.discount_scope === 'cruise'
            ? 'Full discount on the cruise price. If the customer adds extras (food/drinks), they pay for those via Stripe.'
            : 'Full discount on the entire booking — including extras. Bypasses Stripe entirely.'}
        </p>
      )}

      <Field label="Max uses" hint="Auto-rotates when reached">
        <input
          type="number"
          min="1"
          value={form.max_uses}
          onChange={e => set('max_uses', e.target.value)}
          placeholder="e.g. 100"
          className={`${adminInputClass} w-32`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <TextField label="Valid from" type="date" value={form.valid_from} onChange={e => set('valid_from', e.target.value)} />
        <TextField label="Valid until" type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} />
      </div>

      <SelectField
        label="Lock to campaign"
        hint={form.campaign_id
          ? "Code will only validate on this campaign's destination cruise. Bookings auto-attribute commission to the partner."
          : 'Optional — restricts usage + attributes commission'}
        value={form.campaign_id}
        onChange={e => set('campaign_id', e.target.value)}
      >
        <option value="">— None (code works on any cruise) —</option>
        {campaigns.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.partner_name ? ` · ${c.partner_name}` : ''}
            {c.listing_title ? ` → ${c.listing_title}` : ' → Homepage'}
          </option>
        ))}
      </SelectField>

      <TextAreaField
        label="Notes"
        value={form.notes}
        onChange={e => set('notes', e.target.value)}
        placeholder="e.g. Used for Booking.com partner agreement Q2 2026"
        rows={2}
      />
    </AdminFormModal>
  )
}
