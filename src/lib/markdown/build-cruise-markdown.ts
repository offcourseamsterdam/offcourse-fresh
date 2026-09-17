import { buildFrontmatter } from './frontmatter'
import { htmlToMarkdown } from './html-to-markdown'
import { formatRatePrice, type CustomerTypeRate } from '@/lib/fareharbor/customer-types'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

export interface CruiseMarkdownListing {
  slug: string
  title: string
  tagline: string | null
  /** Rich-text HTML from the admin listing editor — converted to Markdown below. */
  description: string | null
  price_display: string | null
  starting_price: number | null
  duration_display: string | null
  max_guests: number | null
  category: string | null
  departure_location: string | null
  hero_image_url: string | null
  highlights: Array<{ text: string }> | null
  faqs: Array<{ question: string; answer: string }> | null
}

/** Renders a single cruise listing's markdown-for-agents representation. */
export function buildCruiseMarkdown(
  listing: CruiseMarkdownListing,
  locale: string,
  customerTypes: CustomerTypeRate[] = []
): string {
  const descriptionMarkdown = listing.description ? htmlToMarkdown(listing.description) : null
  const frontmatterDescription = listing.tagline ?? (descriptionMarkdown ? toPlainText(descriptionMarkdown) : undefined)

  const lines: string[] = [
    buildFrontmatter({
      title: listing.title,
      description: frontmatterDescription,
      image: listing.hero_image_url,
    }),
    '',
    `# ${listing.title}`,
    '',
  ]

  if (listing.tagline) {
    lines.push(`*${listing.tagline}*`, '')
  }

  const facts: string[] = []
  if (listing.price_display) {
    facts.push(`**Price:** ${listing.price_display}`)
  } else if (listing.starting_price != null) {
    const unit = listing.category === 'private' ? 'whole boat' : 'person'
    facts.push(`**Price:** From €${listing.starting_price} (${unit})`)
  }
  if (listing.duration_display) facts.push(`**Duration:** ${listing.duration_display}`)
  if (listing.max_guests != null) facts.push(`**Capacity:** Up to ${listing.max_guests} guests`)
  if (listing.departure_location) facts.push(`**Departs from:** ${listing.departure_location}`)
  if (facts.length > 0) {
    lines.push(...facts.map((f) => `- ${f}`), '')
  }

  if (descriptionMarkdown) {
    lines.push(descriptionMarkdown, '')
  }

  if (customerTypes.length > 0) {
    lines.push('## Rates', '')
    for (const ct of customerTypes) {
      lines.push(`- **${ct.name}:** ${formatRatePrice(ct.price_cents)}`)
    }
    lines.push('')
  }

  const highlights = listing.highlights ?? []
  if (highlights.length > 0) {
    lines.push('## Highlights', '')
    for (const h of highlights) lines.push(`- ${h.text}`)
    lines.push('')
  }

  const faqs = listing.faqs ?? []
  if (faqs.length > 0) {
    lines.push('## FAQ', '')
    for (const faq of faqs) {
      lines.push(`**${faq.question}**`, faq.answer, '')
    }
  }

  lines.push('---', '', `[Book this cruise](${SITE_URL}/${locale}/cruises/${listing.slug})`)

  return lines.join('\n')
}

/** Strips Markdown punctuation for use as short frontmatter metadata, not body content. */
function toPlainText(markdown: string): string {
  return markdown.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim()
}
