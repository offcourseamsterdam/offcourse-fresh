// ── Types ──────────────────────────────────────────────────────────────────────

export interface Extra {
  id: string
  name: string
  description: string | null
  image_url: string | null
  category: string
  scope: string
  applicable_categories: string[] | null
  price_type: string
  price_value: number
  vat_rate: number
  is_required: boolean
  is_active: boolean
  sort_order: number
  created_at: string
}

export type PriceType = 'fixed_cents' | 'percentage' | 'per_person_cents' | 'informational'
export type Scope = 'global' | 'per_listing'
export type Category = 'food' | 'drinks' | 'protection' | 'experience' | 'tax' | 'info'
export type ListingCategory = 'private' | 'shared' | 'standard' | 'special' | 'seasonal' | 'event'

// ── Form state ────────────────────────────────────────────────────────────────

export interface FormState {
  name: string
  description: string
  category: Category
  scope: Scope
  applicable_categories: ListingCategory[]
  price_type: PriceType
  price_value_display: string  // in euros (as user types)
  vat_rate: number
  is_required: boolean
  is_active: boolean
  sort_order: string
}

export function blankForm(): FormState {
  return {
    name: '',
    description: '',
    category: 'food',
    scope: 'global',
    applicable_categories: [],
    price_type: 'fixed_cents',
    price_value_display: '',
    vat_rate: 9,
    is_required: false,
    is_active: true,
    sort_order: '0',
  }
}

export function extraToForm(extra: Extra): FormState {
  const priceType = extra.price_type as PriceType
  let priceDisplay = ''
  if (priceType === 'percentage') {
    priceDisplay = String(extra.price_value)
  } else if (priceType !== 'informational') {
    priceDisplay = (extra.price_value / 100).toFixed(2)
  }
  return {
    name: extra.name,
    description: extra.description ?? '',
    category: extra.category as Category,
    scope: extra.scope as Scope,
    applicable_categories: (extra.applicable_categories ?? []) as ListingCategory[],
    price_type: priceType,
    price_value_display: priceDisplay,
    vat_rate: extra.vat_rate,
    is_required: extra.is_required,
    is_active: extra.is_active,
    sort_order: String(extra.sort_order),
  }
}

export function formToPayload(form: FormState) {
  let price_value = 0
  if (form.price_type === 'percentage') {
    price_value = parseFloat(form.price_value_display) || 0
  } else if (form.price_type !== 'informational') {
    price_value = Math.round((parseFloat(form.price_value_display) || 0) * 100)
  }
  const payload = {
    name: form.name,
    description: form.description || null,
    category: form.category,
    scope: form.scope,
    applicable_categories: form.scope === 'global' ? form.applicable_categories : null,
    price_type: form.price_type,
    price_value,
    vat_rate: form.price_type === 'informational' ? 0 : form.vat_rate,
    is_required: form.is_required,
    is_active: form.is_active,
    sort_order: parseInt(form.sort_order) || 0,
  }
  if (payload.price_type !== 'per_person_cents') {
    payload.is_required = false
  }
  return payload
}

export function groupByCategory(extras: Extra[]): Record<string, Extra[]> {
  const groups: Record<string, Extra[]> = {}
  for (const extra of extras) {
    if (!groups[extra.category]) groups[extra.category] = []
    groups[extra.category].push(extra)
  }
  return groups
}
