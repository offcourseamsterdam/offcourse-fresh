'use client'

import { useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, X } from 'lucide-react'
import {
  CATEGORY_EMOJI,
  EXTRAS_CATEGORIES as CATEGORIES,
  LISTING_CATEGORIES,
  PRICE_TYPES,
  VAT_RATES,
} from '@/lib/constants'
import { Toggle } from './Toggle'
import type { Extra, FormState, Category, Scope, PriceType, ListingCategory } from './types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ExtrasFormModalProps {
  editingExtra: Extra | null
  form: FormState
  onFormChange: (updater: (prev: FormState) => FormState) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
  saving: boolean
  deleting: boolean
  saveError: string | null
  onExtrasUpdate: (extraId: string, imageUrl: string) => void
  onEditingExtraUpdate: (updater: (prev: Extra | null) => Extra | null) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ExtrasFormModal({
  editingExtra,
  form,
  onFormChange,
  onSave,
  onDelete,
  onClose,
  saving,
  deleting,
  saveError,
  onExtrasUpdate,
  onEditingExtraUpdate,
}: ExtrasFormModalProps) {
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Image upload ────────────────────────────────────────────────────────────

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editingExtra || !e.target.files?.[0]) return
    const file = e.target.files[0]
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/admin/extras/${editingExtra.id}/image`, {
        method: 'POST',
        body: formData,
      })
      const text = await res.text()
      let json: { ok: boolean; data?: { url: string }; error?: string } | null = null
      try { json = JSON.parse(text) } catch {
        alert(`Upload failed (HTTP ${res.status}): Server returned non-JSON response. Check Vercel logs.\n\n${text.slice(0, 300)}`)
        return
      }
      if (json?.ok) {
        onEditingExtraUpdate(prev => prev ? { ...prev, image_url: json!.data?.url ?? null } : prev)
        onExtrasUpdate(editingExtra.id, json!.data?.url ?? '')
      } else {
        alert('Image upload failed: ' + (json?.error ?? 'Unknown error'))
      }
    } catch (err) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Network error — check your connection'))
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function toggleListingCategory(cat: ListingCategory) {
    onFormChange(f => ({
      ...f,
      applicable_categories: f.applicable_categories.includes(cat)
        ? f.applicable_categories.filter(c => c !== cat)
        : [...f.applicable_categories, cat],
    }))
  }

  const priceTypeNeedsValue = form.price_type !== 'informational'
  const priceLabel = form.price_type === 'percentage' ? 'Value (%)' : 'Price (€)'
  const pricePlaceholder = form.price_type === 'percentage' ? '15' : '25.00'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card className="border-zinc-300">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {editingExtra ? `Edit: ${editingExtra.name}` : 'New Extra'}
          </CardTitle>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-600">Name <span className="text-red-500">*</span></label>
          <Input
            placeholder="e.g. Prosecco Bottle"
            value={form.name}
            onChange={e => onFormChange(f => ({ ...f, name: e.target.value }))}
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-600">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
          <textarea
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent resize-none"
            rows={2}
            placeholder="Short description shown to customers"
            value={form.description}
            onChange={e => onFormChange(f => ({ ...f, description: e.target.value }))}
          />
        </div>

        {/* Ingredients */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-600">Ingredients / menu items <span className="text-zinc-400 font-normal">(one per line)</span></label>
          <textarea
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent resize-none"
            rows={3}
            placeholder={"Beer €3,50\nWine €25\nProsecco €27"}
            value={(form.ingredients ?? []).join('\n')}
            onChange={e => onFormChange(f => ({
              ...f,
              ingredients: e.target.value ? e.target.value.split('\n') : [],
            }))}
          />
        </div>

        {/* Category + Scope */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600">Category</label>
            <select
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              value={form.category}
              onChange={e => onFormChange(f => ({ ...f, category: e.target.value as Category }))}
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {CATEGORY_EMOJI[cat]} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600">Scope</label>
            <select
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              value={form.scope}
              onChange={e => onFormChange(f => ({ ...f, scope: e.target.value as Scope }))}
            >
              <option value="global">Global — applies to matching listing categories</option>
              <option value="per_listing">Per listing — manually attached to specific listings</option>
            </select>
          </div>
        </div>

        {/* Applicable categories (only when global) */}
        {form.scope === 'global' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600">Applicable listing categories</label>
            <p className="text-xs text-zinc-400">This extra will auto-appear on listings that match any of the selected categories.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {LISTING_CATEGORIES.map(cat => {
                const active = form.applicable_categories.includes(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleListingCategory(cat)}
                    className={`px-3 py-1.5 rounded-md border text-xs capitalize transition-all ${
                      active
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white hover:border-zinc-400 text-zinc-600'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Price type */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-600">Price type</label>
          <select
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            value={form.price_type}
            onChange={e => onFormChange(f => ({ ...f, price_type: e.target.value as PriceType }))}
          >
            {PRICE_TYPES.map(pt => (
              <option key={pt.value} value={pt.value}>{pt.label}</option>
            ))}
          </select>
        </div>

        {/* Price value + VAT side by side (hidden for informational) */}
        {priceTypeNeedsValue && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">{priceLabel}</label>
              <Input
                type="number"
                min="0"
                step={form.price_type === 'percentage' ? '1' : '0.01'}
                placeholder={pricePlaceholder}
                value={form.price_value_display}
                onChange={e => onFormChange(f => ({ ...f, price_value_display: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">VAT rate</label>
              <div className="flex gap-2">
                {VAT_RATES.map(rate => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onFormChange(f => ({ ...f, vat_rate: rate }))}
                    className={`flex-1 py-2 rounded-md border text-xs font-medium transition-all ${
                      form.vat_rate === rate
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white hover:border-zinc-400 text-zinc-600'
                    }`}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Is required (only for per_person_cents) */}
        {form.price_type === 'per_person_cents' && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
              checked={form.is_required}
              onChange={e => onFormChange(f => ({ ...f, is_required: e.target.checked }))}
            />
            <div>
              <p className="text-sm font-medium text-zinc-800">Auto-include, not selectable by customer</p>
              <p className="text-xs text-zinc-400 mt-0.5">Customer sees this as a locked line item (e.g. city tax)</p>
            </div>
          </label>
        )}

        {/* Sort order + Is active */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600">Sort order</label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={form.sort_order}
              onChange={e => onFormChange(f => ({ ...f, sort_order: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600">Status</label>
            <label className="flex items-center gap-2.5 h-9 cursor-pointer">
              <Toggle
                checked={form.is_active}
                onChange={() => onFormChange(f => ({ ...f, is_active: !f.is_active }))}
              />
              <span className="text-sm text-zinc-700">{form.is_active ? 'Active' : 'Inactive'}</span>
            </label>
          </div>
        </div>

        {/* Image upload — only when editing an existing extra */}
        {editingExtra && (
          <div className="space-y-2 pt-1 border-t border-zinc-100">
            <label className="text-xs font-medium text-zinc-600">Image <span className="text-zinc-400 font-normal">(optional thumbnail)</span></label>
            {editingExtra.image_url && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={editingExtra.image_url}
                  alt={editingExtra.name}
                  className="w-16 h-16 rounded-lg object-cover border border-zinc-200"
                />
                <span className="text-xs text-zinc-400">Current image</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingImage}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {uploadingImage ? 'Uploading…' : editingExtra.image_url ? 'Replace image' : 'Upload image'}
              </Button>
              {uploadingImage && (
                <span className="text-xs text-zinc-400">Uploading…</span>
              )}
            </div>
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
          <div>
            {editingExtra && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                onClick={onDelete}
                disabled={deleting || saving}
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || !form.name.trim()}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {saving ? 'Saving…' : editingExtra ? 'Save changes' : 'Create extra'}
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
