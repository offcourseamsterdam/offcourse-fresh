import { buildFrontmatter } from './frontmatter'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

/**
 * Renders the homepage's markdown-for-agents representation. Deliberately
 * short — it orients an agent and points onward rather than duplicating
 * /llms-full.txt's full knowledge base (FAQs, policies, competitive context).
 */
export function buildHomeMarkdown(locale: string): string {
  return [
    buildFrontmatter({
      title: 'Off Course Amsterdam — Your Friend With a Boat',
      description:
        "Private and shared electric canal cruises through Amsterdam's hidden gems. Book direct, zero booking fees.",
    }),
    '',
    '# Off Course Amsterdam',
    '',
    '*Your friend with a boat.*',
    '',
    "Off Course runs private and shared canal cruises through Amsterdam's hidden gems on two fully electric boats, departing from Brouwersgracht 66 in the Jordaan — not the tourist docks at Damrak.",
    '',
    '- **Diana** — max 8 guests, intimate and cozy',
    '- **Curaçao** — max 12 guests, spacious and social',
    '- 100% electric, silent, zero emissions',
    '- Book direct at offcourseamsterdam.com — zero booking fees',
    '',
    `[Browse all cruises](${SITE_URL}/${locale}/cruises)`,
    '',
    `[Read the blog](${SITE_URL}/${locale}/blog)`,
    '',
    `Full AI knowledge base (FAQs, policies, competitive context): [/llms-full.txt](${SITE_URL}/llms-full.txt)`,
  ].join('\n')
}
