/**
 * The command palette's one result shape. `nav` results come from the static
 * nav-items list (client-side, instant); `record` results come from the
 * server search route; `command` is reserved for a later phase (mutating
 * actions like "cancel this booking") — the shape carries it now so adding
 * those later is a new item, not a rewrite of everything that renders one.
 */
export type PaletteItemKind = 'nav' | 'record' | 'command'

/** Which section prefix a query can scope to — see parse-query.ts. */
export type PaletteScope = 'bookings' | 'chats' | 'finance' | 'partners'

export interface PaletteItem {
  id: string
  kind: PaletteItemKind
  /** Group header shown above this result — "Go to", "Bookings", "Chats", … */
  group: string
  title: string
  subtitle?: string
  /** Where Enter takes you. Always a same-app path; the palette never opens external URLs. */
  href: string
  /** lucide-react icon name, same convention as DashboardSidebar's ICON_MAP. */
  icon?: string
  /** Extra words that should match this item even if they're not in the title —
   *  e.g. a nav item for the Kasboek Viator tab keeps "viator" here. */
  keywords?: string[]
  /** Which PaletteScope this item belongs to, for prefix-scoped queries. `nav` items with no
   *  natural scope (Dashboard, Homepage, …) leave this unset and always show for unscoped queries. */
  scope?: PaletteScope
}
