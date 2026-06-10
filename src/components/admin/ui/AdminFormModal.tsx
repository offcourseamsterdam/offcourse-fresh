'use client'

import { X, Loader2 } from 'lucide-react'

interface AdminFormModalProps {
  open: boolean
  title: string
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  saving: boolean
  error: string | null
  submitLabel: string
  /** Tailwind max-width class for the panel. Default matches the original modals. */
  maxWidthClass?: string
  children: React.ReactNode
}

/**
 * Shared shell for admin CRUD modals: backdrop, header with close button,
 * form body, error banner, and Cancel/Submit footer. Markup and classes are
 * lifted verbatim from the modals it replaces (PartnerModal, CampaignModal,
 * PromoCodeFormModal, …) so migrated modals render pixel-identical.
 *
 * The caller owns all field state and validation; this component only owns
 * the chrome around it.
 */
export function AdminFormModal({
  open,
  title,
  onClose,
  onSubmit,
  saving,
  error,
  submitLabel,
  maxWidthClass = 'max-w-md',
  children,
}: AdminFormModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className={`relative bg-white rounded-xl border border-zinc-200 shadow-xl w-full ${maxWidthClass} mx-4 animate-modal-in`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="p-5 space-y-4">
          {children}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
