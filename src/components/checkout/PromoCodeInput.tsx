'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'
import type { PromoResult } from './types'

export function PromoCodeInput({
  grandTotalCents,
  baseAmountCents,
  cityTaxCents,
  initialCode,
  onApplied,
  onRemoved,
  applied,
  required,
  listingId,
}: {
  grandTotalCents: number
  /** Cruise base (no extras). Used so promos discount cruise + city tax only, not extras. */
  baseAmountCents: number
  cityTaxCents: number
  initialCode?: string
  onApplied: (result: PromoResult) => void
  onRemoved: () => void
  applied: PromoResult | null
  required?: boolean
  /** When provided, the server uses this to reject codes scoped to a different cruise. */
  listingId?: string | null
}) {
  const [open, setOpen] = useState(!!initialCode || !!required)
  const [value, setValue] = useState(initialCode ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-validate URL-provided code on mount
  useEffect(() => {
    if (initialCode && !applied) {
      handleApply(initialCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleApply(code?: string) {
    const codeToApply = (code ?? value).trim()
    if (!codeToApply) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: codeToApply,
          amountCents: grandTotalCents,
          baseAmountCents,
          cityTaxCents,
          listingId,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Invalid code.')
      } else {
        onApplied(json.data)
        setError(null)
      }
    } catch {
      setError('Could not validate code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (applied) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-emerald-800">
          <svg className="w-4 h-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <span className="font-semibold">{applied.label}</span>
            {applied.isFull
              ? ' — your cruise is included, no payment needed'
              : ` — ${fmtEuros(applied.discountAmountCents)} off`}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemoved}
          className="text-xs text-emerald-600 hover:text-emerald-800 underline shrink-0"
        >
          Remove
        </button>
      </div>
    )
  }

  return (
    <div>
      {required && !applied && (
        <p className="text-sm font-medium text-zinc-700 mb-2">Enter your booking code to proceed</p>
      )}
      {!open && !required ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-zinc-400 hover:text-zinc-600 underline underline-offset-2 transition-colors"
        >
          Have a promo code?
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApply()}
            placeholder="XXXX"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className={`flex-1 px-4 py-2.5 rounded-xl border text-sm uppercase tracking-widest font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] ${
              error ? 'border-red-400' : 'border-zinc-200'
            }`}
          />
          <button
            type="button"
            onClick={() => handleApply()}
            disabled={loading || !value.trim()}
            className="px-4 py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
    </div>
  )
}
