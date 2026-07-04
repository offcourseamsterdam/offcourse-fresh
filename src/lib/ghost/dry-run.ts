import { getFareHarborClient } from '@/lib/fareharbor/client'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'
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
 *    capacity — FareHarbor's contract. (dry-run.test.ts grep-guards this file
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
export const PLACEHOLDER_CONTACT = {
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

/**
 * A nearby option offered when the asked-for slot isn't bookable: a different
 * time on the same boat, the other boat, or another day. Ranked deterministically
 * and (for the ones we surface) confirmed with a non-mutating validate.
 */
export interface AltSlot {
  date: string
  time: string
  /** Resolved customer-type name (never the requested string) — avoids mislabel. */
  option: string
  boat_id: 'diana' | 'curacao'
  kind: 'same_day_earlier' | 'same_day_later' | 'other_boat' | 'other_day'
  listing_slug: string
  listing_title: string
  guests: number
  /** FareHarbor validate quote (€) when price_is_quote, else a resolve-derived estimate. */
  price_eur: number | null
  /** true = confirmed validate quote; false = ranked-but-unvalidated estimate. */
  price_is_quote: boolean
  /** Resolution hints for a cheap re-resolve on click — NEVER a trust anchor (the book path re-validates live). */
  avail_pk: number
  customer_type_rate_pk: number
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
  /** Nearby options, present ONLY on the not-bookable path (skip-first). */
  alternatives?: AltSlot[]
}

// Bounds for the alternatives finder — the whole feature's cost ceiling.
const ALT_CANDIDATES_RANKED = 6 // cap CPU: rank at most this many before any validate
const ALT_VALIDATE_MAX = 2 // cap FareHarbor cost: validate at most this many same-day candidates
const ALT_RETURNED = 3 // cap prompt tokens / card rows: surface at most this many
const ALT_MAX_DAYS = 2 // cap other-day probing: look at most ±this many days out

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

/** Parse a display time ("5pm", "9am", "14:00", "2:30pm") to minutes-of-day, or null. */
export function parseTimeToMinutes(t: string): number | null {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  if (m[3] === 'pm' && h !== 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Shift a YYYY-MM-DD date by N days (UTC, DST-safe), or null if unparseable. */
function shiftDate(date: string, offsetDays: number): string | null {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/** Whole days between two YYYY-MM-DD dates (absolute). */
function dayDistance(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.round(Math.abs(da - db) / 86_400_000)
}

/**
 * Rank nearby options from one date's availability, the way a dispatcher thinks:
 * same boat + duration at the nearest time first, then the other boat, and —
 * when the results are for a different date — that same product on another day.
 * Pure: no I/O, no validation, no guessing of a different *product*. The finder
 * validates the top few before any are surfaced as bookable.
 *
 * `requestedMinutes` is the asked-for time (minutes-of-day); `input` carries the
 * ORIGINAL request (date + option), so other-day results rank by distance from it.
 */
export function rankAlternatives(
  results: SearchResult[],
  input: BookingProposalInput,
  requestedMinutes: number | null,
): AltSlot[] {
  const listing = results.find(r => r.listing.slug === input.listing_slug)
  if (!listing) return []

  const { boatId: reqBoat, durationMinutes: reqDur } = parseOption(input.option ?? '')
  const guests = Number(input.guests ?? 2)
  const candidateDate = listing.date
  const otherDay = !!input.date && candidateDate !== input.date

  const out: AltSlot[] = []
  const seen = new Set<string>()

  for (const slot of listing.availableSlots) {
    const slotMin = parseTimeToMinutes(slot.startTime)
    for (const ct of slot.customerTypes) {
      if (ct.totalCapacity < 1) continue // not actually bookable
      const sameBoat = reqBoat ? ct.boatId === reqBoat : true
      const sameDur = reqDur != null ? ct.durationMinutes === reqDur : true

      let kind: AltSlot['kind']
      if (otherDay) {
        // Another day: only the SAME product (the human move: "same thing, Saturday").
        if (!(sameBoat && sameDur)) continue
        kind = 'other_day'
      } else {
        // Same day: skip the exact slot that just failed.
        if (slot.startTime === input.time && sameBoat && sameDur) continue
        if (sameBoat && sameDur) {
          kind = slotMin != null && requestedMinutes != null && slotMin < requestedMinutes ? 'same_day_earlier' : 'same_day_later'
        } else if (sameDur && !sameBoat) {
          kind = 'other_boat' // other boat, same duration
        } else {
          continue // different duration — don't offer a different product
        }
      }

      const dedupeKey = `${candidateDate}|${slot.startTime}|${ct.boatId}|${ct.durationMinutes}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      out.push({
        date: candidateDate,
        time: slot.startTime,
        option: ct.name,
        boat_id: ct.boatId,
        kind,
        listing_slug: listing.listing.slug,
        listing_title: listing.listing.title,
        guests,
        price_eur: Math.round(ct.priceCents / 100), // estimate until validated
        price_is_quote: false,
        avail_pk: slot.pk,
        customer_type_rate_pk: ct.pk,
      })
    }
  }

  // Sort key (all ascending → best first):
  //  1. day distance, forward preferred over past at equal distance
  //  2. class: same boat (0) before other boat (1)
  //  3. time distance, later preferred over earlier at equal distance
  //  4. boat: Diana before Curaçao
  const refDate = input.date ?? candidateDate
  const key = (a: AltSlot): number[] => {
    const dist = dayDistance(a.date, refDate)
    const dayKey = dist * 2 + (a.date < refDate ? 1 : 0)
    const classRank = a.kind === 'other_boat' ? 1 : 0
    const aMin = parseTimeToMinutes(a.time)
    const haveTimes = aMin != null && requestedMinutes != null
    const timeDist = haveTimes ? Math.abs(aMin! - requestedMinutes!) : 9999
    const timeKey = timeDist * 2 + (haveTimes && aMin! < requestedMinutes! ? 1 : 0)
    const boatRank = a.boat_id === 'diana' ? 0 : 1
    return [dayKey, classRank, timeKey, boatRank]
  }
  out.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return 0
  })
  return out
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
/**
 * Build the ranked, validated nearby options for a NOT-bookable request. Reuses
 * the date's already-fetched results for same-day candidates (zero extra GETs),
 * validates at most ALT_VALIDATE_MAX of them, then probes a bounded window of
 * other days ONLY if same-day didn't yield enough. Validate-only + fail-closed:
 * an option is surfaced only if FareHarbor confirms it. Best-effort per
 * candidate — a validate that throws just drops that candidate.
 */
async function findAlternatives(input: BookingProposalInput, sameDayResults: SearchResult[]): Promise<AltSlot[]> {
  const guests = Number(input.guests ?? 2)
  const reqMin = parseTimeToMinutes(input.time ?? '')
  const fh = getFareHarborClient()
  const validated: AltSlot[] = []
  let attempts = 0 // total validate calls — the hard FareHarbor-cost ceiling

  // Confirm one candidate with a non-mutating validate; return it priced, or null.
  const validateOne = async (c: AltSlot): Promise<AltSlot | null> => {
    try {
      const v = await fh.validateBooking(c.avail_pk, {
        contact: PLACEHOLDER_CONTACT,
        customers: [{ customer_type_rate: c.customer_type_rate_pk }],
        note: 'Ghost dry-run alternative check — not a real booking',
      })
      if (v.is_bookable !== true) return null
      return {
        ...c,
        price_eur: typeof v.receipt_total === 'number' ? v.receipt_total / 100 : c.price_eur,
        price_is_quote: true,
      }
    } catch {
      return null // a single FareHarbor hiccup just drops this candidate
    }
  }

  // Same day — free candidates from the results already in hand. Cap validate
  // ATTEMPTS (not successes) so a run of sold-out candidates can't amplify calls.
  const sameDay = rankAlternatives(sameDayResults, input, reqMin).slice(0, ALT_CANDIDATES_RANKED)
  for (const c of sameDay) {
    if (attempts >= ALT_VALIDATE_MAX) break
    attempts++
    const ok = await validateOne(c)
    if (ok) validated.push(ok)
  }

  // Other days — only if same-day was thin. One extra fetch + one validate per day.
  if (validated.length < ALT_RETURNED && input.date) {
    const today = amsterdamToday()
    const otherDates: string[] = []
    for (let d = 1; d <= ALT_MAX_DAYS; d++) {
      const fwd = shiftDate(input.date, d)
      if (fwd) otherDates.push(fwd)
      const bwd = shiftDate(input.date, -d)
      if (bwd && bwd >= today) otherDates.push(bwd) // never offer a date in the past
    }
    for (const date of otherDates) {
      if (validated.length >= ALT_RETURNED) break
      let otherResults: SearchResult[]
      try {
        otherResults = await fetchSearchResults(date, guests)
      } catch {
        continue
      }
      // Validate only the single best candidate per day — keep the budget small.
      const best = rankAlternatives(otherResults, input, reqMin)[0]
      if (!best) continue
      attempts++
      const ok = await validateOne(best)
      if (ok) validated.push(ok)
    }
  }

  return validated.slice(0, ALT_RETURNED)
}

/**
 * Would this booking actually go through? Re-derives the exact FareHarbor slot
 * from a human-readable booking request and runs a non-mutating validate.
 * Returns a verdict — never stores anything. This is the shared core used both
 * by the agent's in-loop `check_booking` tool (so it sees failures and
 * self-corrects) and by the post-loop verdict recorder below.
 *
 * With `{ withAlternatives: true }`, a NOT-bookable result is enriched with up
 * to a few ranked, validated nearby options (skip-first: the happy path does
 * zero extra work). Calls ONLY fh.validateBooking — creates no booking, sends
 * no email, holds no capacity. May throw (FareHarbor down); callers decide.
 */
export async function checkBookingViability(
  input: BookingProposalInput,
  opts: { withAlternatives?: boolean } = {},
): Promise<DryRunVerdict> {
  const ranAt = new Date().toISOString()
  if (!input.listing_slug || !input.date || !input.time) {
    return abstainVerdict('Booking is missing a listing, date or time', ranAt)
  }

  // Re-derive the exact FareHarbor slot from the human-readable request.
  const results = await fetchSearchResults(input.date, Number(input.guests ?? 2))
  const resolved = resolveBookingSlot(results, input)
  if ('error' in resolved) {
    const verdict = abstainVerdict(resolved.error, ranAt)
    if (opts.withAlternatives) verdict.alternatives = await findAlternatives(input, results)
    return verdict
  }

  // The ONLY FareHarbor write this module performs — a non-mutating validate.
  const fh = getFareHarborClient()
  const validation = await fh.validateBooking(resolved.availPk, {
    contact: PLACEHOLDER_CONTACT,
    customers: [{ customer_type_rate: resolved.customerTypeRatePk }],
    note: 'Ghost dry-run capability check — not a real booking',
  })
  const verdict = toVerdict(validation, resolved.availPk, ranAt)
  // Skip-first: only spend on alternatives when the asked slot won't book.
  if (!verdict.is_bookable && opts.withAlternatives) {
    verdict.alternatives = await findAlternatives(input, results)
  }
  return verdict
}

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
    // Record alternatives too: if the proposed slot isn't bookable (e.g. the
    // agent's forced final turn skipped check_booking), the card still shows
    // nearby options instead of a dead end.
    const verdict = await checkBookingViability(booking, { withAlternatives: true })
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
