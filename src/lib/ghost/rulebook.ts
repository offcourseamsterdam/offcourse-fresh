import { hasUnlimitedDrinks, type ExtrasLineItem } from '@/lib/catering/filter'

/**
 * THE RULEBOOK — single source of truth for what the Ghost is told and what
 * the code enforces around it. Rendered verbatim on /admin/ghost/rulebook.
 *
 * Two kinds of rules live here:
 *   - PROMPTS: the exact instruction text sent to Claude. Drafters IMPORT
 *     these strings (they don't keep their own copy), so the admin page can
 *     never drift from what the AI actually reads.
 *   - HARD RULES: constraints enforced in TypeScript, not in prompts. Prompts
 *     repeat some of them so the model reasons within them, but the code is
 *     what makes them unbreakable. Each entry names the file that enforces it.
 *
 * Thresholds (the tunable dials) also live here, so the page always shows the
 * live values.
 */

// ── Tunable thresholds (imported by the drafters) ────────────────────────────

/** Guest-move: gaps below this are never worth bothering a guest. */
export const MIN_GAP_MINUTES = 45
/** Guest-move: paid-waiting cost floor (cents) before an ask is drafted. */
export const MIN_GAP_SAVING_CENTS = 2000 // €20
/** Guest-move: how far ahead the optimizer scans for multi-booking days. */
export const OPTIMIZE_HORIZON_DAYS = 14
/** Guest-move: unanswered asks expire after this many hours. */
export const GUEST_MOVE_EXPIRY_HOURS = 48
/** Catering order: how many days of upcoming catering the daily draft covers. */
export const CATERING_LOOKAHEAD_DAYS = 3
/** Snackbox upsell: days before the cruise the offer is drafted. */
export const UPSELL_LEAD_DAYS = 2
/** Monthly availability request: how many days before a month starts captains get asked to fill it in. */
export const AVAILABILITY_REQUEST_LEAD_DAYS = 42
/** Captain schedule digest: the Amsterdam-local hour it goes out, checked DST-safe against the real clock (not a fixed UTC cron time). */
export const SCHEDULE_DIGEST_HOUR_AMSTERDAM = 18
/** Guest-move (every variant): never contact a guest about a departure less than this many hours away — not enough runway for them to notice, decide, and for us to act on a yes (Beer, 2026-08-23: "18 hours, the earlier the better though"). The underlying inefficiency still surfaces as a read-only finding; only the ask itself is withheld. */
export const MIN_RESCHEDULE_NOTICE_HOURS = 18
/** Cross-day consolidation: how many days apart two shared departures can still be asked to merge. Beer, 2026-08-23: start narrow. */
export const CROSS_DAY_WINDOW_DAYS = 1
/** Reschedule incentive — private cruises (Beer, 2026-08-23). */
export const PRIVATE_MOVE_INCENTIVE = 'a bottle of Crémant de Bourgogne (sparkling wine) on the house'
/** Reschedule incentive — shared cruises without Unlimited Drinks already aboard (Beer, 2026-08-23: "the first drinks are free" — one per person, not the full unlimited package). */
export const SHARED_MOVE_INCENTIVE = "everyone's first drink (wine or beer) on the house"

/**
 * The reschedule incentive for one booking — a deterministic lookup, not an
 * AI guess (Beer, 2026-08-23): private cruises always get the sparkling
 * wine bottle; shared cruises get free first drinks UNLESS the booking
 * already has Unlimited Drinks, in which case offering more would be
 * redundant — null (no incentive at all), not a fallback to something else.
 * Used by every move-type drafter (same-day, cross-day, boat-swap) so the
 * rule lives in exactly one place.
 */
export function moveIncentiveFor(category: string | null, extrasSelected: ExtrasLineItem[] | null): string | null {
  if (category === 'private') return PRIVATE_MOVE_INCENTIVE
  return hasUnlimitedDrinks(extrasSelected) ? null : SHARED_MOVE_INCENTIVE
}

/**
 * Deliberately reads the real wall clock (not threaded through as a
 * parameter) — this is an impure, "is it too late RIGHT NOW" check, called
 * only from the drafter/route layer right before a candidate is contacted,
 * never from the pure candidate-finder functions themselves (which stay
 * fixture-testable with fixed dates). See MIN_RESCHEDULE_NOTICE_HOURS.
 */
export function hasEnoughNotice(departureIso: string | null | undefined): boolean {
  if (!departureIso) return false
  const hoursUntil = (new Date(departureIso).getTime() - Date.now()) / (1000 * 60 * 60)
  return hoursUntil >= MIN_RESCHEDULE_NOTICE_HOURS
}

// ── Shared prompt blocks (imported by the drafters) ─────────────────────────

export const SCHEDULE_DAY_PROMPT = `You are the scheduling assistant for Off Course Amsterdam (electric canal boats). Propose a captain for each OPEN shift on the target date below. When you can confidently fill a shift this assigns the captain for real and DMs them the details — there is no human review step first, so follow the rules exactly rather than leaving a borderline call for someone else to catch.

RULES
- Never propose someone whose availability is 'unavailable'.
- Treat 'prefer_not' as a last resort and say so in the reason.
- One person cannot be on two overlapping shifts.
- Prefer spreading work fairly (look at shifts last 7 days).
- Each candidate's hourly rate is shown. When two candidates are equally fair and available, prefer the lower rate — but never sacrifice fairness or availability just to save a few euros.
- If you are not confident a shift can be filled correctly (nobody clearly available, or a genuine tie you can't break), leave it out of "assignments" rather than guessing — an unfilled shift falls back to a human, which is safe; a wrong assignment is not.`

export const SCHEDULE_DAY_JSON = `Return JSON only:
{"assignments": [{"shift_id": "<id>", "staff_id": "<id>", "staff_name": "<name>", "reason": "<short why>"}], "summary": "<1-2 sentences in English on the overall reasoning, including anything you could not solve>"}`

export const CATERING_ORDER_PROMPT = `You are the shadow catering assistant for Off Course Amsterdam. Below are the upcoming cruises that include catering (food/drinks extras, ordered from supplier Pure Boats by email). This is a SHADOW proposal — logged for comparison, nothing is sent.

Draft the consolidated supplier order: per day, the combined items and quantities, and flag any booking whose supplier email is still NOT SENT (those are the urgent ones).`

export const CATERING_ORDER_JSON = `Return JSON only:
{"orders": [{"date": "YYYY-MM-DD", "items": [{"name": "<item>", "quantity": <n>}], "urgent_unsent": <count>}], "summary": "<1-2 sentences in English: what to order, what is urgent>"}`

export const CATERING_UPSELL_PROMPT = `You write for Off Course Amsterdam ("your friend with a boat" — warm, casual, dry humour, never salesy or corporate). Draft a short upsell email. This is a SHADOW draft: a human approves before sending.

Keep it 4-6 sentences: drinks sorted ✓, something to nibble makes it better, the menu highlights, the link. Easy to ignore — one nudge, no pressure. English. Never invent menu items or amounts — only use the real menu provided.`

export const CATERING_UPSELL_JSON = `Return JSON only:
{"email_subject": "<subject>", "email_body": "<plain-text email including the link>"}`

export const OPS_REVIEW_SYSTEM = `You are the shadow operations optimizer for Off Course Amsterdam, an electric canal boat company with two boats (Diana, 8 guests; Curaçao, 12 guests). You review the day's operational plan and recommend the most profitable changes. You are precise, numeric, and honest: an already-optimal day is a good outcome, not a failure.`

export const OPS_REVIEW_INSTRUCTIONS = `HARD RULES (enforced by the system, repeated so you reason within them)
- One captain sails one boat per shift — never propose splitting a captain across boats.
- PRIVATE cruises can appear in MERGE CANDIDATES above (Beer, 2026-08-23: they can swap boats, just never combine with another party's departure — that combining never happens in this pool at all, for either category). Touching one always needs requires_guest_contact: true and guest_impact honestly set — a human decides.
- Prefer the least invasive option: an internal shuffle (no guest notices) beats anything requiring guest contact.
- Every € you cite must come from the FACTS above — never invent numbers. est_saving_cents derives from the printed idle costs / avoided second-boat staffing.
- If the plan is already good, submit exactly one recommendation of type 'none' explaining why (cite the numbers that show it's tight).

WHAT TO LOOK FOR, in order of value
1. maintenance_conflict — a boat scheduled to sail with an open blocking task is a cancelled cruise waiting to happen.
2. staffing_level — open shifts without a captain (revenue at risk), or more captains scheduled than boats need.
3. consolidate_boat — a merge candidate that would take a whole boat off the water (one captain fewer).
4. consolidate_gap — a long paid gap that a time shift (shared cruises only) could close.

You may call get_schedule for surrounding days (context on captain workloads) or search_availability if you need to know whether a slot change even has room. Then submit_ops_review.`

export const GUEST_MOVE_PROMPT = `You write for Off Course Amsterdam ("your friend with a boat" — warm, casual, dry humour, never corporate). Draft a time-change request to a guest. This is a SHADOW draft: a human approves before anything is sent.

- NEVER mention or imply occupancy, headcount, or that a cruise is quiet/empty/undersold — the guest must not be able to infer anything about how full any departure is. Frame this purely as us asking a favour, not as filling a gap.
- The request below states the exact incentive to offer, if any — some bookings genuinely get none. Offer it naturally if given; if none is given, don't invent one or apologize for its absence, just make the plain ask.
- Reversibility, explicitly: if they say yes, we make the change; if they say no (or don't reply), their original time simply stays — either answer is completely fine, no follow-up pressure.
- The message must include the literal placeholder {{link}} exactly once in the SMS and once in the email body — it becomes their personal response button/URL.
- English. SMS max ~300 characters.`

export const CROSS_DAY_MOVE_PROMPT = `You write for Off Course Amsterdam ("your friend with a boat" — warm, casual, dry humour, never corporate). Draft a DATE-change request to a guest: ask if they'd move their booking to a nearby day's departure of the exact same cruise instead — same boat, same time of day, same price. This is a SHADOW draft: a human approves before anything is sent.

- NEVER mention or imply occupancy, headcount, or that a cruise is quiet/empty/undersold, on EITHER day — the guest must not be able to infer anything about how full any departure is (that reads as "this is secretly a private cruise", which it isn't). Frame this purely as us asking a favour, not as filling a gap.
- The request below states the exact incentive to offer, if any — some bookings genuinely get none (they already have Unlimited Drinks). Offer it naturally if given; if none is given, don't invent one or apologize for its absence, just make the plain ask.
- Reversibility, explicitly: if they say yes, we make the change; if they say no (or don't reply), their original date simply stays — either answer is completely fine, no follow-up pressure.
- The message must include the literal placeholder {{link}} exactly once in the SMS and once in the email body — it becomes their personal response button/URL.
- English. SMS max ~300 characters.`

export const BOAT_SWAP_PROMPT = `You write for Off Course Amsterdam ("your friend with a boat" — warm, casual, dry humour, never corporate). Draft a BOAT-change request to a guest: same date, same time, same price, same cruise — just a different one of our two electric boats (Diana, cosy for up to 8; Curaçao, roomier for up to 12), because it lets us run the day with one boat instead of two. This is a SHADOW draft: a human approves before anything is sent.

- NEVER mention or imply occupancy, headcount, or that a cruise is quiet/empty/undersold — the guest must not be able to infer anything about how full any departure is. Frame this purely as us asking a favour, not as filling a gap.
- The request below states the exact incentive to offer, if any — some bookings genuinely get none. Offer it naturally if given; if none is given, don't invent one or apologize for its absence, just make the plain ask.
- Reversibility, explicitly: if they say yes, we make the change; if they say no (or don't reply), their original boat simply stays — either answer is completely fine, no follow-up pressure.
- The message must include the literal placeholder {{link}} exactly once in the SMS and once in the email body — it becomes their personal response button/URL.
- English. SMS max ~300 characters.`

// ── The rulebook entries (rendered on /admin/ghost/rulebook) ─────────────────

export interface HardRule {
  rule: string
  /** The file that enforces it — rules live in code, not in prompts. */
  enforcedIn: string
}

export interface RulebookEntry {
  kind: string
  agentKey: string
  title: string
  /** What the code guarantees, regardless of what the model wants. */
  hardRules: HardRule[]
  /** The exact instruction text sent to Claude (shared constants above). */
  prompt: string
  /** True when the drafter imports the exact string above (zero drift). */
  promptShared: boolean
  /** Runtime data appended to the prompt on each run. */
  dataInjected: string[]
}

export const RULEBOOK: RulebookEntry[] = [
  {
    kind: 'schedule_day',
    agentKey: 'scheduling',
    title: 'Proactive captain scheduling',
    hardRules: [
      { rule: 'Auto-assigns when the AI can confidently fill every open shift on the target date — the captain gets DM\'d the shift + crew-call time + pay immediately, no click needed. Falls back to a shadow proposal a human approves when it can\'t (e.g. nobody available).', enforcedIn: 'src/lib/ghost/agents.ts (autonomy: auto) + src/lib/ghost/ops-drafters.ts (draftOrAssignSchedule)' },
      { rule: 'Only ever touches a shift that is still OPEN with no captain — a manual assignment always wins, whether made before or after the AI runs.', enforcedIn: 'src/lib/scheduling/apply-assignments.ts' },
      { rule: 'Runs on the daily horizon scan (14 days out) AND immediately whenever a new booking opens a shift — never waits for the next cron tick.', enforcedIn: 'src/lib/scheduling/proactive-scheduling.ts' },
      { rule: 'The shadow-proposal fallback still dedupes one-per-target-date; the auto path relies on each shift only ever being assigned once (open → assigned), so it safely re-scans a date as new bookings add shifts to it.', enforcedIn: 'src/lib/ghost/ops-drafters.ts (dedupe)' },
      { rule: 'A shadow proposal left unapproved past its date is scored against what the human actually did (the learning signal) — auto-assigned days are excluded since there is no separate human choice to compare against.', enforcedIn: 'src/lib/ghost/evaluate.ts' },
    ],
    prompt: `${SCHEDULE_DAY_PROMPT}\n\n${SCHEDULE_DAY_JSON}`,
    promptShared: true,
    dataInjected: ['target date', 'staff list + availability + 7-day workload + hourly rate', "the date's shifts (boat, time, cruise, status) + cost per candidate", 'last 5 evaluated drafts vs what the human actually assigned'],
  },
  {
    kind: 'catering_order',
    agentKey: 'catering',
    title: 'Consolidated supplier order',
    hardRules: [
      { rule: `Covers the next ${CATERING_LOOKAHEAD_DAYS} days; skips (zero cost) when no upcoming booking has catering.`, enforcedIn: 'src/lib/ghost/ops-drafters.ts' },
      { rule: 'Shadow only — the supplier email itself goes via the existing catering notify flow, not this proposal.', enforcedIn: 'src/lib/ghost/agents.ts (autonomy: propose)' },
    ],
    prompt: `${CATERING_ORDER_PROMPT}\n\n${CATERING_ORDER_JSON}`,
    promptShared: true,
    dataInjected: ['upcoming bookings with catering items + sent/unsent supplier email status'],
  },
  {
    kind: 'catering_upsell',
    agentKey: 'catering',
    title: 'Snackbox offer for drinks-only bookings',
    hardRules: [
      { rule: 'Audience: catering is EXACTLY the unlimited-drinks package — no food, nothing else. Guests with zero catering belong to the automated extras-upsell cron; the two can never overlap.', enforcedIn: 'src/lib/catering/filter.ts (isDrinksOnlyBooking)' },
      { rule: 'Menu items + prices come from the extras table and are printed into the prompt — the model cannot invent an offer.', enforcedIn: 'src/lib/ghost/ops-drafters.ts' },
      { rule: 'Sending is a human click, and stamps extras_upsell_sent_at — one upsell email per booking, ever, across ALL upsell paths.', enforcedIn: 'src/app/api/admin/ghost/proposals/[id]/route.ts' },
      { rule: `Drafted ${UPSELL_LEAD_DAYS} days before the cruise; one proposal per booking.`, enforcedIn: 'src/lib/ghost/ops-drafters.ts' },
    ],
    prompt: `${CATERING_UPSELL_PROMPT}\n\n${CATERING_UPSELL_JSON}`,
    promptShared: true,
    dataInjected: ['guest + booking summary', 'real food menu (max 3 items, names + prices)', 'their personal pre-order page URL'],
  },
  {
    kind: 'ops_review',
    agentKey: 'operations',
    title: 'Nightly operations review',
    hardRules: [
      { rule: 'All numbers are computed in TypeScript before the model sees them (gaps, idle €, merge candidates, staffing) — every € in a recommendation traces to a computed fact.', enforcedIn: 'src/lib/ghost/ops-review.ts (computeDayFacts)' },
      { rule: 'A "merge candidate" here is a boat swap (this shift\'s own departure could run on a different boat instead), never combining two parties onto one departure — private cruises are included (Beer, 2026-08-23: allowBoatSwap, not allowMerge, gates this pool).', enforcedIn: 'src/lib/ops/profile.ts + computeDayFacts' },
      { rule: 'Read-only tool loop (max 6 turns); the only write is the shadow proposal itself.', enforcedIn: 'src/lib/ghost/agent-runtime.ts' },
      { rule: 'Malformed recommendations are dropped, never repaired or guessed at.', enforcedIn: 'src/lib/ghost/ops-review.ts (validateRecommendations)' },
    ],
    prompt: `SYSTEM\n${OPS_REVIEW_SYSTEM}\n\nTASK (after the computed FACTS block)\n${OPS_REVIEW_INSTRUCTIONS}`,
    promptShared: true,
    dataInjected: ['computed FACTS block: shifts, gaps + idle €, merge candidates, maintenance conflicts, staffing'],
  },
  {
    kind: 'guest_move_request',
    agentKey: 'operations',
    title: 'Guest move request (SMS + email)',
    hardRules: [
      { rule: 'SEQUENTIAL: at most one open ask per day, and at most one new draft per triggering run — guests are never raced against each other.', enforcedIn: 'src/lib/ghost/guest-move-drafter.ts' },
      { rule: 'Private cruises CAN be asked to move (Beer 2026-07-04, same threshold as shared) — but only a TIME/boat change, NEVER merged onto another party\'s departure. Bookings with catering/drinks aboard: never asked (supplier order already placed). Multi-party departures: never asked.', enforcedIn: 'src/lib/ghost/guest-move-drafter.ts (selectMoveCandidate) + src/lib/ops/profile.ts (allowMerge)' },
      { rule: `Only gaps ≥ ${MIN_GAP_MINUTES} min AND ≥ €${(MIN_GAP_SAVING_CENTS / 100).toFixed(0)} paid waiting get an ask, same bar for private and shared; nightly horizon ${OPTIMIZE_HORIZON_DAYS} days, only days with a second booking.`, enforcedIn: 'src/lib/ghost/rulebook.ts (thresholds) + guest-move-drafter.ts' },
      { rule: 'Every new confirmed booking also checks its OWN date immediately (Beer 2026-07-04) — not just the nightly scan — so an opportunity is never left for the next cron.', enforcedIn: 'src/lib/ghost/guest-move-drafter.ts (draftGuestMoveForNewBooking) + webhooks/stripe + admin/booking-flow/book' },
      { rule: 'DRY-RUN: no ask exists until FareHarbor confirmed the target slot. The geometric ideal is snapped to a REAL availability (same boat, same duration, whole party validated non-mutatingly), and the send button re-validates the slot again immediately before dispatch — a stale slot expires the request instead of sending it.', enforcedIn: 'guest-move-drafter.ts (pickSnapSlot/validateMoveSlot/revalidateStoredMove) + proposals/[id]:send_move' },
      { rule: 'Sending is a human click (SMS + email with a personal HMAC link). A guest YES never rebooks anything — Slack pings the team to rebook via admin.', enforcedIn: 'proposals/[id]/route.ts + api/move/respond' },
      { rule: `Unanswered asks expire after ${GUEST_MOVE_EXPIRY_HOURS}h.`, enforcedIn: 'src/lib/ghost/guest-move-drafter.ts (expiry sweep)' },
      { rule: `CROSS-DAY variant (same kind, different opportunity — Beer 2026-08-23): two single-booking shared departures exactly ${CROSS_DAY_WINDOW_DAYS} day apart, same product, combined guests within the receiving boat's capacity. Private cruises never eligible (they never merge at all). Whichever party is SMALLER gets asked to move (a tie defaults to the later day) — not a fixed "later always moves". Same human-approval-then-send flow and tokened response link as the same-day ask — no new send/response code, only a new candidate source and its own incentive rule (see below).`, enforcedIn: 'src/lib/ghost/cross-day-consolidation.ts + cross-day-move-drafter.ts' },
      { rule: `CROSS-DAY: food only excludes the MOVING side (Beer 2026-08-23: food catering only exists on private cruises in practice, but the check stays as a safety net) — a stationary receiving party's own food order is untouched by someone else joining them, so it never disqualifies a pairing. Drinks-only is always fine either side (stocked on the boat, not a supplier delivery). no_reschedule_ask DOES apply to both sides, though — gaining an unasked companion changes a flagged guest's own experience.`, enforcedIn: 'src/lib/ghost/cross-day-consolidation.ts (eligibleToReceive vs eligibleToMove)' },
      { rule: `CROSS-DAY: at most one candidate per booking, ever — real bug fixed 2026-08-23: a booking sitting exactly ${CROSS_DAY_WINDOW_DAYS} day from BOTH neighbors (or two different movers both eyeing the same receiving day's spare capacity) used to produce multiple candidates referencing the same booking; the idempotency lookup (keyed only on booking_id) then silently reused one candidate's drafted message under a DIFFERENT candidate's displayed destination. Highest-saving candidate wins; every other pairing touching either of its two bookings is dropped.`, enforcedIn: 'src/lib/ghost/cross-day-consolidation.ts (dedup pass at the end of findCrossDayConsolidationCandidates)' },
      { rule: `BOAT-SWAP variant (same kind, different opportunity — Beer 2026-08-23: "private cruises can definitely swap Diana for Curaçao"): a single-booking shift that fits cleanly onto another in-use boat's day with no overlap — private AND shared both eligible (allowBoatSwap, never combines two parties onto one departure). DRY-RUN like the same-day ask, but for the SAME time on the OTHER boat rather than a different time on the same one. Priced at the moving boat's full shift cost ("one boat, one day, one shift" — the swap frees that boat's captain entirely).`, enforcedIn: 'src/lib/ghost/ops-review.ts (computeDayFacts) + boat-swap-drafter.ts' },
      { rule: `INCENTIVE (every variant — Beer 2026-08-23): private cruises always get ${PRIVATE_MOVE_INCENTIVE}; shared cruises get ${SHARED_MOVE_INCENTIVE} UNLESS the booking already has Unlimited Drinks, in which case there is NO incentive at all (offering more drinks would be redundant, not a fallback to something else). A deterministic lookup, not an AI guess — the drafter computes it and hands Claude the exact value (or none) to work into the message.`, enforcedIn: 'src/lib/ghost/rulebook.ts (moveIncentiveFor) + every *-move-drafter.ts / boat-swap-drafter.ts' },
      { rule: `MINIMUM NOTICE (every variant — Beer 2026-08-23: "18 hours, the earlier the better"): a guest is never contacted about a departure less than ${MIN_RESCHEDULE_NOTICE_HOURS}h away. The underlying inefficiency still surfaces as a read-only finding; only the ask itself is withheld.`, enforcedIn: 'src/lib/ghost/rulebook.ts (hasEnoughNotice), checked in the drafter/route layer, never inside the pure candidate-finders' },
      { rule: `SEQUENTIAL, ACROSS EVERY MOVE TYPE (Beer 2026-08-23: "max one open ask per day, any type"): a day already mid-conversation with one guest (any move type) never gets a second, different guest asked to rework it too. A cross-day move checks BOTH days it touches.`, enforcedIn: 'src/lib/ghost/guest-move-drafter.ts (openMoveRequestExists), called from every drafter and the Optimizer route' },
      { rule: `PERMANENT GUEST OPT-OUT (Beer 2026-08-23: "one decline, never ask that guest again"): a decline on ANY booking, ANY move type, blocks every future ask to that same email/phone — across all their future bookings too, not just a per-booking dedupe. Recorded the moment the guest taps decline; checked before every future ask, before the FareHarbor dry-run even runs.`, enforcedIn: 'src/lib/ghost/reschedule-opt-outs.ts + api/move/respond' },
      { rule: `DO-NOT-TOUCH FLAG (Beer 2026-08-23: anniversary/birthday bookings — admin-set, never auto-detected from free text): a booking flagged no_reschedule_ask is skipped by every move type entirely, same footing as the other hard eligibility rules. Set from the booking's "Edit details" modal in admin.`, enforcedIn: 'bookings.no_reschedule_ask column, checked in guest-move-drafter.ts (selectMoveCandidate), cross-day-consolidation.ts (eligibleToMove), and ops-review.ts (computeDayFacts merge candidates)' },
    ],
    prompt: GUEST_MOVE_PROMPT,
    promptShared: true,
    dataInjected: ['guest + booking summary', 'current → proposed departure time, boat, unchanged price', 'JSON contract with the exact times'],
  },
  {
    kind: 'maintenance_task',
    agentKey: 'maintenance',
    title: 'Maintenance triage + technician email',
    hardRules: [
      { rule: 'Priority must be exactly essential/cosmetic/wishlist or the draft is dropped.', enforcedIn: 'src/lib/ghost/maintenance-drafter.ts' },
      { rule: 'The technician email only goes out on a human click (two-step confirm).', enforcedIn: 'proposals/[id]/route.ts (send)' },
    ],
    prompt:
      'MIRROR (source of truth in src/lib/ghost/maintenance-drafter.ts):\n\nYou are the shadow maintenance assistant for Off Course Amsterdam (electric canal boats: {{boat names}}). Someone posted this in the "Maintenance and Ideas" channel. This is a SHADOW proposal — nothing is sent; a human reviews it.\n\n1. Assign a PRIORITY — essential (must-fix: safety / boat can\'t run) · cosmetic (nice-to-fix) · wishlist (future idea).\n2. Write a clear short title + 1-3 sentence summary (incorporate photo descriptions).\n3. Draft a friendly, concise email to our technician asking for an estimate/offerte. Sign off as "Off Course Amsterdam" — no corporate fluff.',
    promptShared: false,
    dataInjected: ['the Slack message + reporter', 'Gemini photo descriptions', 'boat names'],
  },
  {
    kind: 'stock_reorder',
    agentKey: 'storage',
    title: 'Supplier reorder email',
    hardRules: [
      { rule: 'Only items at/under their reorder threshold, grouped per supplier.', enforcedIn: 'src/lib/ghost/stock-drafter.ts' },
      { rule: 'Sending is a human click and stamps last_reordered_at on the items.', enforcedIn: 'proposals/[id]/route.ts (send)' },
    ],
    prompt:
      'MIRROR (source of truth in src/lib/ghost/stock-drafter.ts):\n\nYou are the shadow storage assistant for Off Course Amsterdam (electric canal boats). The stock items below are at or under their reorder level and need restocking from {{supplier}}. This is a SHADOW proposal — nothing is sent; a human reviews it.\n\nDraft a short, friendly reorder email IN DUTCH: greet the supplier, list the reorder quantities, keep it human and to the point, sign off as "Off Course Amsterdam".',
    promptShared: false,
    dataInjected: ['low items with counts + reorder quantities', 'supplier name/email'],
  },
  {
    kind: 'reply_draft',
    agentKey: 'inbox',
    title: 'Inbox reply draft',
    hardRules: [
      { rule: 'Read-only tools (availability, bookings, menu, viability check); the only write is the shadow draft.', enforcedIn: 'src/lib/ghost/agent-runtime.ts + tools.ts' },
      { rule: 'Availability/prices NEVER from memory — the search_availability tool is the only source of truth.', enforcedIn: 'src/lib/chat/shadow-drafter.ts (prompt) + tools.ts' },
      { rule: 'Taught knowledge (ghost_knowledge, pinned first) + your last 5 real replies are injected into every draft — the learning loop.', enforcedIn: 'src/lib/chat/shadow-drafter.ts' },
    ],
    prompt:
      'MIRROR (source of truth in src/lib/chat/shadow-drafter.ts):\n\nYou are the shadow inbox agent for Off Course Amsterdam. A customer sent a chat message; investigate what you need (tools), then submit the reply you WOULD send. Reply in the customer\'s language, chat-length, brand voice. Dates/availability/prices: never from memory — use search_availability. Before promising a specific booking, call check_booking; only propose alternatives it returned. A booking proposal must be unambiguous (exact boat + duration) and needs the customer\'s name + email.',
    promptShared: false,
    dataInjected: ['taught knowledge + pinned facts', 'your last 5 real replies vs drafts', 'customer profile + conversation transcript'],
  },
  {
    kind: 'booking_proposal',
    agentKey: 'booking',
    title: 'Booking proposal (dry-run only)',
    hardRules: [
      { rule: 'IRREVERSIBLE kind: ceiling pinned to dry_run forever — the Ghost may VALIDATE against FareHarbor but can never create, refund or pay out. A CI test fails if anyone bumps this.', enforcedIn: 'src/lib/ghost/agents.ts + agent-runtime.test.ts' },
      { rule: 'The one-click "book" action re-resolves and re-validates the slot live through the normal money path — the proposal itself is never trusted.', enforcedIn: 'proposals/[id]/route.ts (book) + src/lib/ghost/book-from-proposal.ts' },
    ],
    prompt: 'Emitted by the inbox agent via its terminal submit_booking_proposal tool — see the Inbox reply draft entry; there is no separate prompt.',
    promptShared: false,
    dataInjected: ['validated slot (listing, date, time, option, party size) from check_booking'],
  },
  {
    kind: 'cancellation_request',
    agentKey: 'cancellation',
    title: 'Cancellation request (one-click cancel + refund)',
    hardRules: [
      { rule: 'The refund € is NEVER the model\'s number. check_cancellation_terms (in-loop) and the stored payload both come from calculateRefundCents() in src/lib/cancellation/policy.ts — the model only supplies which booking, never the amount.', enforcedIn: 'src/lib/ghost/cancellation-terms.ts' },
      { rule: 'Recomputed again at the moment of the click, not read from the payload — a proposal drafted yesterday may have crossed a refund-tier boundary overnight.', enforcedIn: 'proposals/[id]/route.ts (cancel_booking action)' },
      { rule: 'Never proposed for an OTA-sourced booking (Withlocals/GetYourGuide/etc.) — that platform holds the customer relationship and must be cancelled there.', enforcedIn: 'cancellation-terms.ts (isOtaBooking) + the route\'s refusal' },
      { rule: 'The one-click action reuses the existing, already-guarded /api/admin/bookings/[id]/cancel route (FareHarbor cancel + Stripe refund) — never a second, forked money path.', enforcedIn: 'proposals/[id]/route.ts (cancel_booking) calling bookings/[id]/cancel' },
    ],
    prompt: 'Emitted by the inbox agent via its terminal submit_cancellation_request tool — see the Inbox reply draft entry; there is no separate prompt.',
    promptShared: false,
    dataInjected: ['the matched booking (from get_customer_bookings/search_bookings_by_details)', 'cancellation terms from check_cancellation_terms — hours until departure, refund tier, refund €, all policy-computed'],
  },
]

/** Entries for one agent, in registry order. */
export function rulebookForAgent(agentKey: string): RulebookEntry[] {
  return RULEBOOK.filter(e => e.agentKey === agentKey)
}
