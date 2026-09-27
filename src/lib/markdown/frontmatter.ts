/**
 * Builds the YAML frontmatter block used by every hand-authored markdown
 * variant (cruise pages, blog posts, homepage). Keys with an empty/null/
 * undefined value are omitted rather than written as blank lines.
 */
export function buildFrontmatter(fields: Record<string, string | null | undefined>): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (!value) continue
    lines.push(`${key}: ${escapeYaml(value)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

function escapeYaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim()}"`
}
