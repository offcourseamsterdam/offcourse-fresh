'use client'

import { X, Loader2 } from 'lucide-react'

interface AdminFormModalProps {
  /** Omit (or pass true) when the parent conditionally renders the modal. */
  open?: boolean
  title: string
  /** Small grey line under the title, e.g. "Note is also synced to FareHarbor." */
  subtitle?: string
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  saving: boolean
  error: string | null
  submitLabel: string
  /** Disable submit beyond `saving` — e.g. required field still empty. */
  submitDisabled?: boolean
  /** Left-aligned footer content, e.g. a Delete button. */
  footerStart?: React.ReactNode
  /** Tailwind max-width class for the panel. Default matches the original modals. */
  maxWidthClass?: string
  children: React.ReactNode
}

/**
 * THE admin modal. Every CRUD form modal (create/edit partner, campaign,
 * promo code, extra, booking details …) renders through this shell so they
 * all share one look: backdrop, header with close button, form body, error
 * banner, and Cancel/Submit footer.
 *
 * Action dialogs are deliberately NOT this component: destructive confirms
 * (CancelBookingModal) and multi-action wizards (RescheduleBookingModal,
 * AddCateringModal) have different footer semantics and keep their own shells.
 *
 * The caller owns all field state and validation; this component only owns
 * the chrome around it.
 */
export function AdminFormModal({
  open = true,
  title,
  subtitle,
  onClose,
  onSubmit,
  saving,
  error,
  submitLabel,
  submitDisabled = false,
  footerStart,
  maxWidthClass = 'max-w-md',
  children,
}: AdminFormModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal — capped to the viewport so long forms scroll inside the panel */}
      <div className={`relative bg-white rounded-xl border border-zinc-200 shadow-xl w-full ${maxWidthClass} animate-modal-in max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="p-5 space-y-4 overflow-y-auto">
          {children}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className={`flex items-center gap-2 pt-1 ${footerStart ? 'justify-between' : 'justify-end'}`}>
            {footerStart && <div>{footerStart}</div>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving || submitDisabled} className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
