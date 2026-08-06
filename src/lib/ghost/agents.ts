/**
 * The Ghost's agent registry — one agent per operation domain.
 *
 * An "agent" here is a goal + a toolbox + a trigger. Active agents run
 * agentic loops (Anthropic tool use): they decide what to look up, call
 * read-only tools against the truth, and end by submitting a proposal —
 * still shadow, still never executing. Planned agents are listed so the
 * Ghost page shows the full operations map before their tables exist.
 *
 * Adding an agent = add it here + give it tools (tools.ts) + a trigger
 * (event hook or ghost-ops cron) + a card renderer. See CLAUDE.md.
 */

export type AgentStatus = 'active' | 'planned'

/**
 * The autonomy ladder — how far a proposal kind is trusted to act.
 *   propose  — write a shadow proposal, nothing else (today's floor)
 *   dry_run  — also run a NON-MUTATING check against the real system
 *              (FareHarbor validate) and attach a verdict; still nothing
 *              created, no email. "Would this have worked?"
 *   ask      — surface an Approve button; a human click performs the real,
 *              reversible action. NEVER reachable for irreversible kinds.
 *   auto     — fires without a click (far future, lowest-stakes kinds only).
 */
export type AutonomyLevel = 'propose' | 'dry_run' | 'ask' | 'auto'

const LEVEL_ORDER: AutonomyLevel[] = ['propose', 'dry_run', 'ask', 'auto']
export function levelRank(level: AutonomyLevel): number {
  return LEVEL_ORDER.indexOf(level)
}

/**
 * Money / irreversible kinds. Their ceiling is pinned to 'dry_run' forever:
 * the agent may VALIDATE a booking but can never create one, refund, or pay
 * out without a human. Enforced by agent-runtime.test.ts + the execute chokepoint.
 */
export const IRREVERSIBLE_KINDS = ['booking_proposal'] as const

/** The highest level a kind may EVER reach — the hard safety ceiling. */
export const AUTONOMY_CEILING: Record<string, AutonomyLevel> = {
  reply_draft: 'ask',
  booking_proposal: 'dry_run', // irreversible — validate only, never create
  // Correcting an existing paid booking's contact info + resending its
  // confirmation IS reversible (unlike creating a booking/consuming a real FH
  // slot) — a human click performing the real action is the right ceiling,
  // same as catering_order/maintenance_task. Never auto: it touches a paying
  // customer's record and sends them an email.
  booking_correction: 'ask',
  catering_order: 'ask',
  catering_upsell: 'ask', // guest-facing email — always a human click
  // Owner-approved 2026-08-06 (Beer, explicit): proactive auto-assign.
  // Raised from 'ask' so schedule_day can reach 'auto' below. Still fully
  // reversible — an auto-assigned shift is a normal 'assigned' row a human
  // can reassign in Planning like any other, it just never sat waiting for
  // an Approve click. Never touches a shift a human (or an earlier proposal)
  // already assigned; see applyScheduleAssignments's open+unassigned guard.
  schedule_day: 'auto',
  maintenance_task: 'ask',
  stock_reorder: 'ask',
  ops_review: 'ask', // may one day get an Apply button; never auto — it moves boats and people
  guest_move_request: 'ask', // contacting a guest is ALWAYS a human click; never auto
  // Read-only fact blocks — no action button exists yet for either, so there's
  // nothing an autonomy climb would even mean. Raise this ceiling only once a
  // real one-click action (e.g. auto-creating the FareHarbor booking) is built.
  ota_availability: 'propose',
  ota_booking_ready: 'propose',
}

/** The kind's CURRENT operating level (must be ≤ its ceiling). */
export const AUTONOMY_LEVEL: Record<string, AutonomyLevel> = {
  reply_draft: 'propose',
  booking_proposal: 'dry_run', // validates each proposal against FareHarbor
  // Starts directly at its ceiling, same precedent as schedule_day: the whole
  // point is a one-click "Confirm & resend" action from day one, not a
  // shadow-only note nobody can act on.
  booking_correction: 'ask',
  catering_order: 'propose',
  catering_upsell: 'propose', // draft only; the send button is the 'ask' rung
  // Owner-approved 2026-08-06: was 'ask' (2026-07-04's one-click Approve) —
  // now assigns automatically, DMs the captain the shift + crew-call time +
  // pay, and only falls back to a shadow proposal a human must approve when
  // the AI can't confidently fill every open shift on the target date (see
  // draftOrAssignSchedule in ops-drafters.ts).
  schedule_day: 'auto',
  maintenance_task: 'propose',
  stock_reorder: 'propose',
  ops_review: 'propose', // shadow-only until its outcome history earns a climb
  guest_move_request: 'dry_run', // every ask is FH-validated before draft AND re-validated before send
  ota_availability: 'propose',
  ota_booking_ready: 'propose',
}

export function autonomyForKind(kind: string): AutonomyLevel {
  return AUTONOMY_LEVEL[kind] ?? 'propose'
}

export interface GhostAgent {
  key: string
  name: string
  description: string
  status: AgentStatus
  /** agent_proposals.kind values this agent produces */
  kinds: string[]
  /** What triggers it */
  trigger: string
}

/** An agent's current autonomy level = the max across the kinds it owns. */
export function agentAutonomy(agent: GhostAgent): AutonomyLevel {
  return agent.kinds.reduce<AutonomyLevel>((max, kind) => {
    const level = autonomyForKind(kind)
    return levelRank(level) > levelRank(max) ? level : max
  }, 'propose')
}

export const GHOST_AGENTS: GhostAgent[] = [
  {
    key: 'inbox',
    name: 'Inbox agent',
    description:
      'Reads every inbound chat message, looks up the customer, taught knowledge and live availability, and drafts the reply it would send.',
    status: 'active',
    kinds: ['reply_draft'],
    trigger: 'every inbound customer message',
  },
  {
    key: 'booking',
    name: 'Booking agent',
    description:
      'When a customer asks to book or reschedule, checks real FareHarbor availability and proposes the booking action chain (slot, listing, party size).',
    status: 'active',
    kinds: ['booking_proposal'],
    trigger: 'booking intent detected in a conversation',
  },
  {
    key: 'catering',
    name: 'Catering agent',
    description:
      'Watches upcoming cruises with catering extras and proposes the consolidated supplier order, flagging unsent supplier emails. Also drafts snackbox offers for guests who only booked drinks.',
    status: 'active',
    kinds: ['catering_order', 'catering_upsell'],
    trigger: 'daily ops cron (15:00 UTC)',
  },
  {
    key: 'booking_correction',
    name: 'Booking correction agent',
    description:
      'When a customer says they already booked and paid but their contact details on file are wrong (a typo, a different address), looks up the real booking by name/date instead of exact contact match, and proposes correcting it plus resending the confirmation.',
    status: 'active',
    kinds: ['booking_correction'],
    trigger: 'booking correction intent detected in a conversation',
  },
  {
    key: 'scheduling',
    name: 'Scheduling agent',
    description:
      "Assigns captains to open shifts automatically — availability, overlap checks, 7-day workload fairness, and cost all weighed per candidate — and DMs the captain their shift. Falls back to a shadow proposal for a human to approve when it can't confidently fill a shift.",
    status: 'active',
    kinds: ['schedule_day'],
    trigger: 'daily horizon scan (14 days, 15:00 UTC) + immediately when a new booking opens a shift',
  },
  {
    key: 'maintenance',
    name: 'Maintenance agent',
    description:
      'Reads the "Maintenance and Ideas" Slack channel, triages each post by priority (essential / cosmetic / wishlist), describes attached photos, and drafts a quote-request email to the technician for one-click human approval.',
    status: 'active',
    kinds: ['maintenance_task'],
    trigger: 'every post in the Maintenance & Ideas Slack channel',
  },
  {
    key: 'storage',
    name: 'Storage agent',
    description:
      'Watches stock counts (staff scan a QR in the storage room and tap +/-) and, when an item drops to its reorder level, drafts a supplier reorder email per supplier for one-click human approval.',
    status: 'active',
    kinds: ['stock_reorder'],
    trigger: 'stock count submitted (QR form or admin grid)',
  },
  {
    key: 'operations',
    name: 'Operations optimizer',
    description:
      "Reviews tomorrow's full plan — shifts, gaps, boats, captains, blocking maintenance — and proposes the most profitable improvements with the € reasoning shown: close a paid gap, consolidate onto one boat, fix the staffing level.",
    status: 'active',
    kinds: ['ops_review', 'guest_move_request'],
    trigger: 'daily ops cron (15:00 UTC)',
  },
  {
    key: 'ota',
    name: 'OTA agent',
    description:
      'Recognizes Withlocals/GetMyBoat notification emails and checks real availability for a new request, or flags a confirmed booking for the team to create manually — never drafts a customer reply, since these platforms handle guest communication themselves.',
    status: 'active',
    kinds: ['ota_availability', 'ota_booking_ready'],
    trigger: 'every inbound OTA notification email',
  },
]

/** Map a proposal kind to its agent key (for grouping in the Ghost page). */
export function agentForKind(kind: string): GhostAgent | null {
  return GHOST_AGENTS.find(a => a.kinds.includes(kind)) ?? null
}
