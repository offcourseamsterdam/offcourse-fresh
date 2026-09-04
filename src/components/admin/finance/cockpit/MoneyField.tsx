'use client'

import { Field, adminInputClass } from '@/components/admin/ui/fields'

interface MoneyFieldProps {
  label: string
  hint?: string
  /** Euros as typed ("1234,56" or "1234.56"); convert with eurosToCents on submit. */
  value: string
  onChange: (value: string) => void
  required?: boolean
  placeholder?: string
  disabled?: boolean
}

/** A euro amount input: "€" prefix, decimal keypad on mobile, free-text so Dutch commas work. */
export function MoneyField({ label, hint, value, onChange, required, placeholder = '0', disabled }: MoneyFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <span className="absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400 pointer-events-none">€</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          disabled={disabled}
          className={`${adminInputClass} pl-7 tabular-nums`}
        />
      </div>
    </Field>
  )
}
