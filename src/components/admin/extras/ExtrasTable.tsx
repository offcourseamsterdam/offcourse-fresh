'use client'

import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CATEGORY_EMOJI,
  formatExtraPrice as formatPrice,
} from '@/lib/constants'
import { Toggle } from './Toggle'
import type { Extra, Category } from './types'
import { groupByCategory } from './types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ExtrasTableProps {
  extras: Extra[]
  onEdit: (extra: Extra) => void
  onToggleActive: (extra: Extra) => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const categoryOrder: Category[] = ['food', 'drinks', 'protection', 'experience', 'tax', 'info']

// ── Component ──────────────────────────────────────────────────────────────────

export function ExtrasTable({ extras, onEdit, onToggleActive }: ExtrasTableProps) {
  const groups = groupByCategory(extras)
  const sortedCategories = categoryOrder.filter(cat => groups[cat] && groups[cat].length > 0)
  const allCategoriesWithExtras = [
    ...sortedCategories,
    ...Object.keys(groups).filter(c => !categoryOrder.includes(c as Category)),
  ]

  return (
    <div className="space-y-6">
      {allCategoriesWithExtras.map(cat => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">{CATEGORY_EMOJI[cat] ?? '📦'}</span>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 capitalize">{cat}</h2>
            <span className="text-xs text-zinc-300">{groups[cat]?.length ?? 0}</span>
          </div>

          <div className="rounded-lg border border-zinc-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden sm:table-cell">Scope</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Price</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden md:table-cell">VAT</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Active</th>
                    <th className="px-4 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {(groups[cat] ?? []).sort((a, b) => a.sort_order - b.sort_order).map(extra => (
                    <tr key={extra.id} className="hover:bg-zinc-50 transition-colors">
                      {/* Name + image */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {extra.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={extra.image_url}
                              alt={extra.name}
                              className="w-8 h-8 rounded object-cover flex-shrink-0"
                            />
                          ) : (
                            <span className="w-8 h-8 rounded bg-zinc-100 flex items-center justify-center text-base flex-shrink-0">
                              {CATEGORY_EMOJI[extra.category] ?? '📦'}
                            </span>
                          )}
                          <div>
                            <p className="font-medium text-zinc-900">{extra.name}</p>
                            {extra.is_required && (
                              <span className="text-xs text-amber-600 font-medium">Required</span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Scope */}
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <Badge variant="secondary" className="capitalize text-xs">{extra.scope}</Badge>
                      </td>
                      {/* Price */}
                      <td className="px-4 py-3 text-zinc-700 font-medium whitespace-nowrap">
                        {formatPrice(extra)}
                      </td>
                      {/* VAT */}
                      <td className="px-4 py-3 text-zinc-400 text-xs hidden md:table-cell">
                        {extra.price_type !== 'informational' ? `${extra.vat_rate}%` : '—'}
                      </td>
                      {/* Active toggle */}
                      <td className="px-4 py-3 text-center">
                        <Toggle
                          checked={extra.is_active}
                          onChange={() => onToggleActive(extra)}
                        />
                      </td>
                      {/* Edit button */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onEdit(extra)}
                          className="p-1.5 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
