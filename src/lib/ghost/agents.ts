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
 * out without a human. Enforced by agents.test.ts + the execute chokepoint.
 */
export const IRREVERSIBLE_KINDS = ['booking_proposal'] as const

/** The highest level a kind may EVER reach — the hard safety ceiling. */
export const AUTONOMY_CEILING: Record<string, AutonomyLevel> = {
  reply_draft: 'ask',
  booking_proposal: 'dry_run', // irreversible — validate only, never create
  catering_order: 'ask',
  schedule_day: 'ask',
  maintenance_task: 'ask',
  stock_order: 'ask',
}

/** The kind's CURRENT operating level (must be ≤ its ceiling). */
export const AUTONOMY_LEVEL: Record<string, AutonomyLevel> = {
  reply_draft: 'propose',
  booking_proposal: 'dry_run', // validates each proposal against FareHarbor
  catering_order: 'propose',
  schedule_day: 'propose',
  maintenance_task: 'propose',
  stock_order: 'propose',
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
      'Watches upcoming cruises with catering extras and proposes the consolidated supplier order, flagging unsent supplier emails.',
    status: 'active',
    kinds: ['catering_order'],
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
      'Will watch boat issues and engine-hour service intervals, proposing maintenance tasks and availability blocks. Needs the maintenance board (vision doc §9) first.',
    status: 'planned',
    kinds: ['maintenance_task'],
    trigger: 'issue reports + engine-hour thresholds (planned)',
  },
  {
    key: 'storage',
    name: 'Storage agent',
    description:
      'Will watch stock counts vs upcoming bookings and propose supplier orders before anything runs out. Needs the stock tables (vision doc §3) first.',
    status: 'planned',
    kinds: ['stock_order'],
    trigger: 'QR stock counts + weekly forecast (planned)',
  },
]

/** Map a proposal kind to its agent key (for grouping in the Ghost page). */
export function agentForKind(kind: string): GhostAgent | null {
  return GHOST_AGENTS.find(a => a.kinds.includes(kind)) ?? null
}
