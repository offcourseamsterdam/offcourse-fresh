import type { PaletteScope } from './types'

/** Single-letter prefix + a space narrows the query to one scope, GitHub/Linear-style. */
const PREFIXES: Record<string, PaletteScope> = {
  b: 'bookings',
  c: 'chats',
  f: 'finance',
  p: 'partners',
}

export interface ParsedQuery {
  /** The query with any recognized prefix stripped, trimmed. */
  text: string
  /** Set only when the query started with a recognized "x " prefix. */
  scope: PaletteScope | null
}

/**
 * "b diana" -> { text: "diana", scope: "bookings" }
 * "b" (no trailing space) -> { text: "b", scope: null } — a one-letter query
 * is a real search term, not a dangling prefix.
 * "" / "   " -> { text: "", scope: null }
 */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx > 0) {
    const maybePrefix = trimmed.slice(0, spaceIdx).toLowerCase()
    const scope = PREFIXES[maybePrefix]
    if (scope) {
      return { text: trimmed.slice(spaceIdx + 1).trim(), scope }
    }
  }
  return { text: trimmed.trim(), scope: null }
}
