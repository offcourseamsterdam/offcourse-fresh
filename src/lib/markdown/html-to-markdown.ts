import TurndownService from 'turndown'

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' })

/**
 * Converts rich-text HTML (WYSIWYG-authored listing descriptions, WordPress
 * post bodies) to clean Markdown — no tags, no &nbsp; entities, no page
 * chrome. Shared by every markdown-for-agents builder that touches a
 * rich-text field.
 */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim()
}
