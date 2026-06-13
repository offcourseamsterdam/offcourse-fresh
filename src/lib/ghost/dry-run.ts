import { getFareHarborClient } from '@/lib/fareharbor/client'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AvailabilitySlot, SearchResult } from '@/types'
import type { FHValidationResult } from '@/lib/fareharbor/types'

/**
 * Dry-run execution for booking_proposal — "would this have booked?"
 *
 * This is the FIRST and ONLY place the Ghost reaches FareHarbor to *act*,
 * so it is built with full money-path rigor (red-team invariants):
 *
 *  - Calls ONLY fh.validateBooking (POST /bookings/validate/). It never
 *    references the create or rebook endpoints, and never POSTs to the real
 *    booking route. validate creates no booking, sends no email, holds no
 *    capacity — FareHarbor's contract. (A unit test grep-guards this file
 *    against the forbidden tokens, so even this comment avoids them.)
 *  - Fail-closed: is_bookable is true ONLY on a 200 with is_bookable===true.
 *    Any throw, ambiguity, or missing slot ⇒ is_bookable:false.
 *  - Exact-match-or-abstain: the proposed time must match exactly one slot
 *    and one fitting customer-type option, else we abstain (no guessed slot).
 *  - Synthetic placeholder contact — never the real customer's PII.
 *  - The proposal stays status:'shadow'. The verdict lives in payload.verdict,
 *    a NON-actionable field. Nothing here can escalate to a real booking.
 */

// Never the real customer — validate emits no email, so a placeholder costs
// nothing and guarantees no customer can be contacted by a dry run. Must be a
// VALID format though: FareHarbor's validate rejects malformed contacts (the
// .invalid TLD and all-zero phone fail its check), so we use a syntactically
// valid, role-based address on our own domain + a valid-format NL mobile.
const PLACEHOLDER_CONTACT = {
  name: 'Ghost dry-run (capability check)',
  email: 'ghost-dryrun@offcourseamsterdam.com',
  phone: '+31612345678',
}

export interface BookingProposalInput {
  listing_slug?: string
  date?: string
  time?: string
  guests?: number
  option?: string
}

export interface ResolvedSlot {
  availPk: number
  customerTypeRatePk: number
  boatId: string
  optionName: string
}

export interface DryRunVerdict {
  ran_at: string
  is_bookable: boolean
  /** Why, for the team — FareHarbor code or our own abstain reason. */
  code: string | null
  error: string | null
  /** FareHarbor quote at validate time — NOT the charged amount. */
  receipt_total_eur: number | null
  checked_avail_pk: number | null
}

/**
 * Resolve a free-text booking proposal to an exact FareHarbor slot + option.
 * Returns null when zero or >1 candidates match — we abstain rather than
 * validate a guessed slot (red-team: a confident verdict for the wrong slot
 * is worse than no verdict).
 */
export function resolveBookingSlot(
  results: SearchResult[],
  input: BookingProposalInput,
): ResolvedSlot | { error: string } {
  const listing = results.find(r => r.listing.slug === input.listing_slug)
  if (!listing) return { error: 'Listing no longer in availability results' }

  const timeMatches = listing.availableSlots.filter(
    (s: AvailabilitySlot) => s.startTime === input.time,
  )
  if (timeMatches.length === 0) return { error: `Slot ${input.time ?? '?'} no longer available` }
  if (timeMatches.length > 1) return { error: `Ambiguous: ${timeMatches.length} slots at ${input.time}` }

  const slot = timeMatches[0]
  const guests = Number(input.guests ?? 0)

  // The explicit option (boat + duration) is the STRONGEST signal and selects
  // directly. Crucially we do NOT pre-filter by party size: private boats list
  // min/max party as 1/1 (you book the boat, quantity 1, not per-person), so a
  // party filter would wrongly exclude Diana for a 4-guest private booking.
  let candidates = slot.customerTypes
  if (input.option) {
    const want = parseOption(input.option)
    let narrowed = candidates
    if (want.boatId) narrowed = narrowed.filter(ct => ct.boatId === want.boatId)
    if (want.durationMinutes != null) narrowed = narrowed.filter(ct => ct.durationMinutes === want.durationMinutes)
    if (narrowed.length === 0) {
      // Fall back to an exact name match before giving up on the option.
      narrowed = candidates.filter(ct => ct.name.toLowerCase() === input.option!.toLowerCase())
    }
    if (narrowed.length > 0) candidates = narrowed
  }

  // Only when the option didn't pin it down (e.g. shared per-person types with
  // no boat/duration) do we use party-fit as a tiebreaker.
  if (candidates.length > 1) {
    const fit = candidates.filter(ct => guests >= ct.minimumParty && guests <= ct.maximumParty)
    if (fit.length > 0) candidates = fit
  }

  if (candidates.length === 0) return { error: `No option fits ${guests} guests at ${input.time}` }
  if (candidates.length > 1) return { error: `Ambiguous: ${candidates.length} options fit — needs a specific boat + duration` }

  const ct = candidates[0]
  return { availPk: slot.pk, customerTypeRatePk: ct.pk, boatId: ct.boatId, optionName: ct.name }
}

/** Parse a free-text option like "Diana - 2 Hours" / "Curaçao 2h" / "Diana 2 uur". */
export function parseOption(option: string): { boatId?: string; durationMinutes?: number } {
  const lower = option.toLowerCase()
  const boatId = lower.includes('diana') ? 'diana' : lower.includes('cura') ? 'curacao' : undefined
  // "2 hours" / "2h" / "2 uur" / "1.5 hour" / "90 min"
  const hourMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hour|hours|uur|uren)/)
  const minMatch = lower.match(/(\d+)\s*(?:m|min|minutes|minuten)\b/)
  let durationMinutes: number | undefined
  if (hourMatch) durationMinutes = Math.round(parseFloat(hourMatch[1].replace(',', '.')) * 60)
  else if (minMatch) durationMinutes = parseInt(minMatch[1], 10)
  return { boatId, durationMinutes }
}

/** Map a FareHarbor validation result to a stored verdict. Fail-closed. */
export function toVerdict(
  validation: FHValidationResult,
  availPk: number,
  ranAt: string,
): DryRunVerdict {
  return {
    ran_at: ranAt,
    is_bookable: validation.is_bookable === true, // only literal true counts
    code: validation.code ?? null,
    error: validation.error ?? null,
    receipt_total_eur:
      typeof validation.receipt_total === 'number' ? validation.receipt_total / 100 : null,
    checked_avail_pk: availPk,
  }
}

/** An abstain/error verdict — is_bookable always false. */
export function abstainVerdict(reason: string, ranAt: string): DryRunVerdict {
  return { ran_at: ranAt, is_bookable: false, code: 'not_validated', error: reason, receipt_total_eur: null, checked_avail_pk: null }
}

/**
 * Run the dry run for one booking_proposal and store the verdict on it.
 * Best-effort: never throws. Idempotent-friendly (callers may skip if a
 * verdict already exists). Returns the verdict (or null if not applicable).
 */
export async function dryRunBookingProposal(proposalId: string): Promise<DryRunVerdict | null> {
  const ranAt = new Date().toISOString()
  try {
    const supabase = createAdminClient()
    const { data: proposal } = await supabase
      .from('agent_proposals')
      .select('id, kind, payload')
      .eq('id', proposalId)
      .single()
    if (!proposal || proposal.kind !== 'booking_proposal') return null

    const payload = (proposal.payload ?? {}) as Record<string, unknown>
    const booking = (payload.booking ?? {}) as BookingProposalInput
    if (!booking.listing_slug || !booking.date || !booking.time) {
      return await storeVerdict(supabase, proposal.id, payload, abstainVerdict('Proposal missing slug/date/time', ranAt))
    }

    // Re-derive the exact FareHarbor slot from the human-readable proposal.
    const results = await fetchSearchResults(booking.date, Number(booking.guests ?? 2))
    const resolved = resolveBookingSlot(results, booking)
    if ('error' in resolved) {
      return await storeVerdict(supabase, proposal.id, payload, abstainVerdict(resolved.error, ranAt))
    }

    // The ONLY FareHarbor write this module performs — a non-mutating validate.
    const fh = getFareHarborClient()
    const validation = await fh.validateBooking(resolved.availPk, {
      contact: PLACEHOLDER_CONTACT,
      customers: [{ customer_type_rate: resolved.customerTypeRatePk }],
      note: 'Ghost dry-run capability check — not a real booking',
    })

    const verdict = toVerdict(validation, resolved.availPk, ranAt)
    return await storeVerdict(supabase, proposal.id, payload, verdict)
  } catch (err) {
    console.error('[ghost/dry-run] failed:', err instanceof Error ? err.message : err)
    // Best-effort: don't store a verdict on infra failure (leave it pending).
    return abstainVerdict('Dry-run errored — try Re-check', ranAt)
  }
}

/** Write the verdict into payload.verdict. Status stays 'shadow' — always. */
async function storeVerdict(
  supabase: ReturnType<typeof createAdminClient>,
  proposalId: string,
  payload: Record<string, unknown>,
  verdict: DryRunVerdict,
): Promise<DryRunVerdict> {
  const nextPayload = JSON.parse(JSON.stringify({ ...payload, verdict }))
  await supabase.from('agent_proposals').update({ payload: nextPayload }).eq('id', proposalId)
  return verdict
}
