import type { AgentCard } from './types'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

/**
 * Builds the A2A Agent Card served at /.well-known/agent-card.json.
 * Only advertises what src/app/api/a2a/route.ts actually implements —
 * SendMessage and GetTask over JSON-RPC, two read-only skills, no
 * streaming/push notifications/auth. See docs/features/a2a-agent.md.
 */
export function buildAgentCard(): AgentCard {
  return {
    name: 'Off Course Amsterdam',
    description:
      "Boutique electric canal cruise operator in Amsterdam. This agent answers questions about cruise pricing, boats, and durations, and checks live availability for a specific date and guest count — the same data available on offcourseamsterdam.com, reachable programmatically for agent-to-agent workflows.",
    supportedInterfaces: [
      {
        url: `${SITE_URL}/api/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    provider: {
      url: SITE_URL,
      organization: 'Off Course Amsterdam',
    },
    version: '1.0.0',
    documentationUrl: `${SITE_URL}/api/v1/docs`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'list_cruises',
        name: 'List Cruises',
        description: 'Lists every publicly bookable canal cruise, with tagline, price, and duration.',
        tags: ['cruises', 'catalog', 'pricing'],
        examples: [
          'What cruises does Off Course Amsterdam offer?',
          'List available boat tours in Amsterdam and their prices.',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'check_availability',
        name: 'Check Availability',
        description: 'Checks live availability for one cruise on a given date and guest count.',
        tags: ['availability', 'booking', 'schedule'],
        examples: ['Is the Curaçao cruise available on July 4th 2026 for 4 guests?'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  }
}
