'use client'

import { Copy, Check } from 'lucide-react'
import { fmtAdminDate } from '@/lib/admin/format'
import type { AdminPromoCode } from '@/lib/admin/types'

export function fmtDiscount(code: AdminPromoCode): string {
  if (code.discount_type === 'full') return '100% off (free)'
  if (code.discount_type === 'percentage') return `${code.discount_value}% off`
  if (code.discount_type === 'fixed_amount' && code.fixed_discount_cents != null)
    return `€${(code.fixed_discount_cents / 100).toFixed(2)} off`
  return '—'
}

interface CodesTableProps {
  codes: AdminPromoCode[]
  copiedId: string | null
  onCopy: (c: AdminPromoCode) => void
  onEdit: (c: AdminPromoCode) => void
  onToggleActive: (c: AdminPromoCode) => void
}

export function CodesTable({ codes, copiedId, onCopy, onEdit, onToggleActive }: CodesTableProps) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Code</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden sm:table-cell">Label</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden md:table-cell">Discount</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Uses</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Expires</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {codes.map(c => (
            <CodeRow
              key={c.id}
              code={c}
              copiedId={copiedId}
              onCopy={onCopy}
              onEdit={onEdit}
              onToggleActive={onToggleActive}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodeRow({
  code: c,
  copiedId,
  onCopy,
  onEdit,
  onToggleActive,
}: {
  code: AdminPromoCode
  copiedId: string | null
  onCopy: (c: AdminPromoCode) => void
  onEdit: (c: AdminPromoCode) => void
  onToggleActive: (c: AdminPromoCode) => void
}) {
  const usagePct = c.max_uses ? Math.min(100, Math.round((c.uses_count / c.max_uses) * 100)) : null

  return (
    <tr className={c.is_active ? '' : 'opacity-50'}>
      {/* Code */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs bg-zinc-100 text-zinc-800 px-2 py-0.5 rounded select-all">
            {c.code}
          </code>
          <button
            onClick={() => onCopy(c)}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
            title="Copy code"
          >
            {copiedId === c.id
              ? <Check className="w-3.5 h-3.5 text-emerald-500" />
              : <Copy className="w-3.5 h-3.5" />
            }
          </button>
        </div>
        {/* Mobile: label + discount inline */}
        <div className="sm:hidden mt-1 text-xs text-zinc-500">
          {c.label} · {fmtDiscount(c)}
        </div>
      </td>

      {/* Label */}
      <td className="px-4 py-3 text-zinc-700 hidden sm:table-cell">{c.label}</td>

      {/* Discount */}
      <td className="px-4 py-3 hidden md:table-cell">
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
          c.discount_type === 'full'
            ? 'bg-violet-100 text-violet-700'
            : c.discount_type === 'fixed_amount'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-amber-100 text-amber-700'
        }`}>
          {fmtDiscount(c)}
        </span>
      </td>

      {/* Uses */}
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="flex items-center gap-2">
          <span className="text-zinc-700 tabular-nums">
            {c.uses_count}{c.max_uses != null ? ` / ${c.max_uses}` : ''}
          </span>
          {usagePct != null && (
            <div className="w-16 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-red-400' : usagePct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
        </div>
      </td>

      {/* Expires */}
      <td className="px-4 py-3 text-zinc-500 hidden lg:table-cell text-xs">{fmtAdminDate(c.valid_until)}</td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(c)}
            className="text-xs text-zinc-400 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onToggleActive(c)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              c.is_active
                ? 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'
                : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
            }`}
            title={c.is_active ? 'Deactivate' : 'Reactivate'}
          >
            {c.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </td>
    </tr>
  )
}
