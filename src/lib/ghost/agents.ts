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
  catering_order: 'ask',
  catering_upsell: 'ask', // guest-facing email — always a human click
  schedule_day: 'ask',
  maintenance_task: 'ask',
  stock_reorder: 'ask',
  ops_review: 'ask', // may one day get an Apply button; never auto — it moves boats and people
  guest_move_request: 'ask', // contacting a guest is ALWAYS a human click; never auto
}

/** The kind's CURRENT operating level (must be ≤ its ceiling). */
export const AUTONOMY_LEVEL: Record<string, AutonomyLevel> = {
  reply_draft: 'propose',
  booking_proposal: 'dry_run', // validates each proposal against FareHarbor
  catering_order: 'propose',
  catering_upsell: 'propose', // draft only; the send button is the 'ask' rung
  schedule_day: 'ask', // owner-approved 2026-07-04: Approve assigns the captains (one click, reversible)
  maintenance_task: 'propose',
  stock_reorder: 'propose',
  ops_review: 'propose', // shadow-only until its outcome history earns a climb
  guest_move_request: 'dry_run', // every ask is FH-validated before draft AND re-validated before send
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
    key: 'scheduling',
    name: 'Scheduling agent',
    description:
      "Proposes captains for tomorrow's open shifts using availability, overlap checks and 7-day workload fairness.",
    status: 'active',
    kinds: ['schedule_day'],
    trigger: 'daily ops cron (15:00 UTC)',
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
]

/** Map a proposal kind to its agent key (for grouping in the Ghost page). */
export function agentForKind(kind: string): GhostAgent | null {
  return GHOST_AGENTS.find(a => a.kinds.includes(kind)) ?? null
}
