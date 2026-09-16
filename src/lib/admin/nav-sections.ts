// Admin nav structure + the section → color mapping used across the admin UI
// (sidebar groups, the colored "eyebrow" above each page's title, active-state
// accents). One shared source so the sidebar and every page agree on which
// color belongs to which section — see docs/features/admin-design-system.md.

export interface NavItem {
  href: string
  label: string
  icon: string
  badge?: 'pending-catering-count' | 'inbox-open-count' | 'finance-inbox-open-count'
  comingSoon?: boolean
  /**
   * Path prefix that counts as "this item" for active highlighting, when it
   * differs from `href` — e.g. Finance links to /admin/finance/overview but
   * every /admin/finance/* sub-page should light it up.
   */
  activePrefix?: string
}

export interface NavSection {
  label: string
  /** Bright brand swatch — dots, active-item icon tint. */
  color: string
  /** Darker, readable-on-light version of `color` — eyebrow text. */
  ink: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    label: 'Operations',
    color: '#9bb7fd',
    ink: '#34449a',
    items: [
      // The dashboard has always existed at /admin (today's cruises, revenue,
      // captain cover) but was only reachable by editing the URL — it's the
      // natural landing page, so it leads the section.
      { href: '/admin',           label: 'Dashboard', icon: 'dashboard' },
      { href: '/admin/bookings',  label: 'Bookings',  icon: 'bookings' },
      { href: '/admin/inbox',     label: 'Inbox',     icon: 'inbox',     badge: 'inbox-open-count' },
      { href: '/admin/catering',  label: 'Catering',  icon: 'catering',  badge: 'pending-catering-count' },
      { href: '/admin/planning',  label: 'Planning',  icon: 'planning' },
      { href: '/admin/scheduling', label: 'Availability', icon: 'schedule' },
      { href: '/admin/maintenance', label: 'Maintenance', icon: 'maintenance' },
      { href: '/admin/stock',      label: 'Stock',      icon: 'stock' },
      { href: '/admin/customers', label: 'Customers', icon: 'customers', comingSoon: true },
      // Moved from Content (2026-08-22): captain-assignment/bonus management makes this an
      // operational task now, not content curation — see docs/plans/2026-08-22-reviews-bonuses-and-attribution.md.
      { href: '/admin/reviews',   label: 'Reviews',   icon: 'reviews' },
    ],
  },
  {
    label: 'Content',
    color: '#a8d65a',
    ink: '#3b6614',
    items: [
      { href: '/admin/homepage',   label: 'Homepage',   icon: 'images' },
      { href: '/admin/boats',      label: 'Boats',      icon: 'cruises' },
      { href: '/admin/cruises',    label: 'Cruises',    icon: 'cruises' },
      { href: '/admin/extras',     label: 'Extras',     icon: 'extras' },
    ],
  },
  {
    label: 'Marketing',
    color: '#f4829a',
    ink: '#9b1c3a',
    items: [
      { href: '/admin/campaigns',    label: 'Campaigns',    icon: 'campaigns' },
      { href: '/admin/partners',     label: 'Partners',     icon: 'campaigns' },
      { href: '/admin/promo-codes',   label: 'Promo Codes',   icon: 'promocodes' },
      { href: '/admin/ai-visibility', label: 'AI Visibility', icon: 'sparkles' },
      { href: '/admin/blog',          label: 'Blog',          icon: 'blog',      comingSoon: true },
    ],
  },
  {
    label: 'Performance',
    color: '#fec201',
    ink: '#7a5800',
    items: [
      { href: '/admin/statistics', label: 'Statistics', icon: 'statistics' },
      { href: '/admin/google-ads', label: 'Google Ads', icon: 'campaigns' },
      { href: '/admin/finance/overview', label: 'Finance', icon: 'finance', badge: 'finance-inbox-open-count', activePrefix: '/admin/finance' },
    ],
  },
  {
    label: 'Admin',
    color: '#b8a9c9',
    ink: '#5b3f84',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'users' },
    ],
  },
  {
    label: 'Dev',
    color: '#8f8fab',
    ink: '#50506a',
    items: [
      { href: '/admin/ghost',               label: 'Ghost AI',              icon: 'ghost' },
      { href: '/admin/notifications',       label: 'Notifications',         icon: 'notifications' },
      { href: '/admin/fareharbor',          label: 'FareHarbor API',        icon: 'fareharbor' },
      { href: '/admin/fareharbor-settings', label: 'FH Settings',           icon: 'fareharbor' },
      { href: '/admin/connections',        label: 'Other API Connections', icon: 'connections',  comingSoon: true },
      { href: '/admin/review-tool',        label: 'Review Tool',           icon: 'reviewtool',  comingSoon: true },
      { href: '/admin/image-optimization', label: 'Image Optimization',    icon: 'images' },
    ],
  },
]

/** Section lookup by label — what `<AdminEyebrow label="Content" />` reads from. */
export const SECTION_BY_LABEL: Record<string, NavSection> = Object.fromEntries(
  navSections.map(s => [s.label, s])
)

/**
 * Does `path` (locale already stripped, e.g. "/admin/cruises/42") belong to this
 * nav item? Portal roots (the "/admin" dashboard, "/captain" home) only match
 * exactly — otherwise every page would light up the dashboard entry too.
 */
export function isNavItemActive(item: NavItem, path: string): boolean {
  const prefix = item.activePrefix ?? item.href
  const isPortalRoot = prefix.split('/').filter(Boolean).length <= 1
  if (isPortalRoot) return path === prefix
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** Strip a leading "/{locale}" segment from a pathname. */
export function stripLocale(pathname: string, locale: string): string {
  const stripped = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), '')
  return stripped === '' ? '/' : stripped
}
