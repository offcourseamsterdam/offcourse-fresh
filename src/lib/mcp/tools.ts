import { locales } from '@/lib/i18n/config'

/**
 * MCP `tools/list` entries. Execution is shared with the A2A server's
 * skills (src/lib/a2a/skills.ts::runSkill) — "tool" (MCP) and "skill" (A2A)
 * are two protocols' names for the same underlying capability, so the id
 * here matches the A2A skill id exactly and both call the same function.
 */
export const MCP_TOOLS = [
  {
    name: 'list_cruises',
    description: 'Lists every publicly bookable canal cruise, with tagline, price, and duration.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string', enum: [...locales], description: 'Defaults to "en".' },
      },
    },
  },
  {
    name: 'check_availability',
    description: 'Checks live availability for one cruise on a given date and guest count.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Cruise slug, from list_cruises.' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
        guests: { type: 'integer', minimum: 1, maximum: 50, description: 'Defaults to 2.' },
      },
      required: ['slug', 'date'],
    },
  },
] as const
