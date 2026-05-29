import { createAdminClient } from '@/lib/supabase/admin'

export interface PromoCodeRow {
  id: string
  code: string
  label: string
  discount_type: 'percentage' | 'fixed_amount' | 'full'
  discount_value: number | null
  fixed_discount_cents: number | null
  max_uses: number | null
  uses_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  /** When set, the code is locked to this campaign's destination listing
   *  AND bookings using it auto-attribute commission to the campaign's partner. */
  campaign_id: string | null
  /** What the discount applies to:
   *  'cruise' = base + city tax only (extras pay full — partner-deal default);
   *  'all'    = grand total including extras. */
  discount_scope: 'cruise' | 'all'
}

/** Resolved campaign details for a scoped promo code — fetched on demand. */
export interface CampaignScope {
  campaign_id: string
  listing_id: string | null
  partner_id: string | null
  percentage_value: number | null
  investment_type: string | null
}

export type ValidationResult =
  | { ok: true; code: PromoCodeRow }
  | { ok: false; reason: string; message: string }

export function normalizeCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[\s-]/g, '')
  if (stripped.length !== 8) return stripped
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`
}

// Injectable lookup for testability — real callers omit it and get the DB lookup.
type LookupFn = (normalised: string) => Promise<PromoCodeRow | null>
type ScopeLookupFn = (campaignId: string) => Promise<CampaignScope | null>

interface ValidateOptions {
  /** When provided, scoped codes (codes with campaign_id set) must match this listing. */
  listingId?: string | null
  /** Injectable code lookup for tests. */
  lookup?: LookupFn
  /** Injectable scope lookup for tests. */
  scopeLookup?: ScopeLookupFn
}

export async function validatePromoCode(
  rawCode: string,
  options?: ValidateOptions | LookupFn,
): Promise<ValidationResult> {
  // Back-compat: older callers pass `lookup` directly as the 2nd arg.
  const opts: ValidateOptions = typeof options === 'function'
    ? { lookup: options }
    : (options ?? {})

  const code = normalizeCode(rawCode.trim())

  if (!code) {
    return { ok: false, reason: 'empty', message: 'Please enter a promo code.' }
  }

  const row = await (opts.lookup ?? dbLookup)(code)

  if (!row) {
    return { ok: false, reason: 'not_found', message: 'This code doesn\'t exist.' }
  }

  if (!row.is_active) {
    return { ok: false, reason: 'inactive', message: 'This code is no longer active.' }
  }

  const now = new Date()

  if (row.valid_from && new Date(row.valid_from) > now) {
    return { ok: false, reason: 'not_yet_valid', message: 'This code isn\'t valid yet.' }
  }

  if (row.valid_until && new Date(row.valid_until) < now) {
    return { ok: false, reason: 'expired', message: 'This code has expired.' }
  }

  if (row.max_uses !== null && row.uses_count >= row.max_uses) {
    return { ok: false, reason: 'max_uses_reached', message: 'This code has reached its usage limit.' }
  }

  // Campaign scoping: when the code has campaign_id, the listing must match.
  if (row.campaign_id && opts.listingId !== undefined) {
    const scope = await (opts.scopeLookup ?? dbScopeLookup)(row.campaign_id)
    if (!scope) {
      return { ok: false, reason: 'scope_missing', message: 'This code is locked to a campaign that no longer exists.' }
    }
    if (scope.listing_id && opts.listingId && scope.listing_id !== opts.listingId) {
      return { ok: false, reason: 'scope_mismatch', message: 'This code isn\'t valid for this cruise.' }
    }
  }

  return { ok: true, code: row }
}

async function dbLookup(normalised: string): Promise<PromoCodeRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('promo_codes')
    .select('id, code, label, discount_type, discount_value, fixed_discount_cents, max_uses, uses_count, valid_from, valid_until, is_active, campaign_id, discount_scope')
    .eq('code', normalised)
    .maybeSingle()
  return (data as PromoCodeRow) ?? null
}

/** Fetch the campaign scope details (listing + partner + commission) for a scoped code. */
export async function dbScopeLookup(campaignId: string): Promise<CampaignScope | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('campaigns')
    .select('id, listing_id, partner_id, percentage_value, investment_type')
    .eq('id', campaignId)
    .maybeSingle()
  if (!data) return null
  return {
    campaign_id: data.id,
    listing_id: data.listing_id ?? null,
    partner_id: data.partner_id ?? null,
    percentage_value: data.percentage_value ?? null,
    investment_type: data.investment_type ?? null,
  }
}
