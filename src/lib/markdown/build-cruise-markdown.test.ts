import { describe, it, expect } from 'vitest'
import { buildCruiseMarkdown, type CruiseMarkdownListing } from './build-cruise-markdown'

const BASE: CruiseMarkdownListing = {
  slug: 'sunset-private-charter',
  title: 'Sunset Private Charter',
  tagline: 'The city slows down from here.',
  description: 'A private cruise through the canals at golden hour.',
  price_display: null,
  starting_price: null,
  duration_display: '1.5 hours',
  max_guests: 12,
  category: 'private',
  departure_location: 'Brouwersgracht 66',
  hero_image_url: 'https://example.com/hero.jpg',
  highlights: null,
  faqs: null,
}

describe('buildCruiseMarkdown', () => {
  it('includes frontmatter, heading, tagline, and a booking link', () => {
    const md = buildCruiseMarkdown(BASE, 'en')
    expect(md).toContain('title: "Sunset Private Charter"')
    expect(md).toContain('description: "The city slows down from here."')
    expect(md).toContain('image: "https://example.com/hero.jpg"')
    expect(md).toContain('# Sunset Private Charter')
    expect(md).toContain('*The city slows down from here.*')
    expect(md).toContain('[Book this cruise](https://offcourseamsterdam.com/en/cruises/sunset-private-charter)')
  })

  it('uses the locale passed in for the booking link', () => {
    const md = buildCruiseMarkdown(BASE, 'nl')
    expect(md).toContain('/nl/cruises/sunset-private-charter')
  })

  it('prefers price_display over a starting_price fallback', () => {
    const md = buildCruiseMarkdown({ ...BASE, price_display: 'From €310 total' }, 'en')
    expect(md).toContain('**Price:** From €310 total')
  })

  it('falls back to starting_price and labels it "whole boat" for private listings', () => {
    const md = buildCruiseMarkdown({ ...BASE, starting_price: 310 }, 'en')
    expect(md).toContain('**Price:** From €310 (whole boat)')
  })

  it('labels the starting_price fallback "person" for non-private listings', () => {
    const md = buildCruiseMarkdown({ ...BASE, category: 'shared', starting_price: 35 }, 'en')
    expect(md).toContain('**Price:** From €35 (person)')
  })

  it('omits the facts bullet list entirely when nothing is known', () => {
    const md = buildCruiseMarkdown(
      { ...BASE, price_display: null, starting_price: null, duration_display: null, max_guests: null, departure_location: null },
      'en'
    )
    expect(md).not.toContain('**Price:**')
    expect(md).not.toContain('**Duration:**')
  })

  it('renders customer-type rates under a Rates heading', () => {
    const md = buildCruiseMarkdown(BASE, 'en', [
      { name: 'Diana 1.5h', customer_type_pk: 1, price_cents: 31000 },
      { name: 'Diana 2h', customer_type_pk: 2, price_cents: null },
    ])
    expect(md).toContain('## Rates')
    expect(md).toContain('- **Diana 1.5h:** €310')
    expect(md).toContain('- **Diana 2h:** Price on request')
  })

  it('omits the Rates heading when no customer types are given', () => {
    const md = buildCruiseMarkdown(BASE, 'en')
    expect(md).not.toContain('## Rates')
  })

  it('renders highlights as a bullet list', () => {
    const md = buildCruiseMarkdown({ ...BASE, highlights: [{ text: 'Live local skipper' }, { text: 'Electric and silent' }] }, 'en')
    expect(md).toContain('## Highlights')
    expect(md).toContain('- Live local skipper')
    expect(md).toContain('- Electric and silent')
  })

  it('renders FAQs as question/answer pairs', () => {
    const md = buildCruiseMarkdown(
      { ...BASE, faqs: [{ question: 'Is there a toilet?', answer: 'No, but we make pee-break stops.' }] },
      'en'
    )
    expect(md).toContain('## FAQ')
    expect(md).toContain('**Is there a toilet?**')
    expect(md).toContain('No, but we make pee-break stops.')
  })

  it('falls back to the description for frontmatter when there is no tagline', () => {
    const md = buildCruiseMarkdown({ ...BASE, tagline: null }, 'en')
    expect(md).toContain('description: "A private cruise through the canals at golden hour."')
  })

  it('converts a rich-text HTML description to clean markdown in the body', () => {
    const md = buildCruiseMarkdown(
      { ...BASE, description: '<p>Join a local captain.<br><br>No fixed script,&nbsp;no tourist traps.</p>' },
      'en'
    )
    expect(md).not.toContain('<p>')
    expect(md).not.toContain('<br>')
    expect(md).not.toContain('&nbsp;')
    expect(md).toContain('Join a local captain.')
    expect(md).toContain('no tourist traps.')
  })

  it('strips markdown punctuation from an HTML description used as the frontmatter fallback', () => {
    const md = buildCruiseMarkdown(
      { ...BASE, tagline: null, description: '<p>This is <strong>bold</strong> stuff.</p>' },
      'en'
    )
    expect(md).toContain('description: "This is bold stuff."')
  })
})
