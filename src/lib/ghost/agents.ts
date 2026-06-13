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
