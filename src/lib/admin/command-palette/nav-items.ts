import { navSections } from '@/lib/admin/nav-sections'
import { ITEMS as FINANCE_SUBNAV_ITEMS } from '@/components/admin/finance/cockpit/FinanceSubnav'
import type { PaletteItem } from './types'

/**
 * Extra search words for a page whose title alone wouldn't catch what
 * someone actually types — a real boat name, an English synonym for a Dutch
 * label, the platforms a page covers.
 */
const KEYWORD_OVERRIDES: Record<string, string[]> = {
  '/admin/boats': ['diana', 'curacao', 'curaçao', 'fleet'],
  '/admin/finance/overview': ['kasboek', 'cashbook', 'finance'],
  '/admin/reviews': ['google', 'tripadvisor', 'withlocals'],
  '/admin/finance': ['kasboek', 'cashbook'],
}

/**
 * The legacy Kasboek page (`/admin/finance`) has one tab per external
 * source, reachable only by clicking a tab inside the page — not its own
 * route. These give the palette a direct "Finance → Kasboek → Viator"-style
 * result for each, deep-linking via `?tab=`. Keys match `ALL_TAB_KEYS` in
 * `src/app/[locale]/admin/finance/page.tsx` — keep the two in sync.
 */
const KASBOEK_TABS: Array<{ tab: string; title: string; keywords: string[] }> = [
  { tab: 'btw-dashboard', title: 'Kasboek → BTW dashboard', keywords: ['btw', 'vat', 'tax dashboard'] },
  { tab: 'invoices', title: 'Kasboek → Open invoices', keywords: ['invoices', 'facturen', 'open facturen'] },
  { tab: 'partners', title: 'Kasboek → Partners', keywords: ['partners'] },
  { tab: 'city-tax', title: 'Kasboek → City tax', keywords: ['city tax', 'toeristenbelasting', 'tourist tax'] },
  { tab: 'vat', title: 'Kasboek → Stripe (Website)', keywords: ['stripe', 'website'] },
  { tab: 'zettle', title: 'Kasboek → Zettle', keywords: ['zettle'] },
  { tab: 'withlocals', title: 'Kasboek → Withlocals', keywords: ['withlocals'] },
  { tab: 'getyourguide', title: 'Kasboek → GetYourGuide', keywords: ['getyourguide', 'gyg'] },
  { tab: 'viator', title: 'Kasboek → Viator', keywords: ['viator'] },
  { tab: 'boatlocal', title: 'Kasboek → BoatLocal', keywords: ['boatlocal', 'boat local'] },
  { tab: 'revolut', title: 'Kasboek → Revolut', keywords: ['revolut'] },
  { tab: 'clickandboat', title: 'Kasboek → Click & Boat', keywords: ['clickandboat', 'click and boat', 'click & boat'] },
  { tab: 'getmyboat', title: 'Kasboek → GetMyBoat', keywords: ['getmyboat', 'get my boat'] },
  { tab: 'barqo', title: 'Kasboek → Barqo', keywords: ['barqo'] },
  { tab: 'fareharbor', title: 'Kasboek → FareHarbor', keywords: ['fareharbor', 'fare harbor'] },
]

/**
 * Every static, always-navigable palette entry — sidebar pages, the Finance
 * subnav's own pages, and one entry per Kasboek tab. Excludes `comingSoon`
 * sidebar items (there's nowhere for the palette to send you) and
 * `soon`-flagged Finance subnav items. Pure and locale-less — hrefs are
 * relative (`/admin/bookings`); the caller prefixes the locale, same
 * convention as DashboardSidebar.
 */
export function buildNavItems(): PaletteItem[] {
  const fromSidebar: PaletteItem[] = navSections.flatMap(section =>
    section.items
      .filter(item => !item.comingSoon)
      .map(item => ({
        id: `nav:${item.href}`,
        kind: 'nav' as const,
        group: 'Go to',
        title: item.label,
        subtitle: section.label,
        href: item.href,
        icon: item.icon,
        keywords: KEYWORD_OVERRIDES[item.href],
      }))
  )

  const fromFinanceSubnav: PaletteItem[] = FINANCE_SUBNAV_ITEMS
    .filter(item => !item.soon)
    .map(item => ({
      id: `nav:${item.href}`,
      kind: 'nav' as const,
      group: 'Go to',
      title: item.label,
      subtitle: 'Finance',
      href: item.href,
      keywords: KEYWORD_OVERRIDES[item.href],
    }))

  const fromKasboekTabs: PaletteItem[] = KASBOEK_TABS.map(t => ({
    id: `nav:/admin/finance?tab=${t.tab}`,
    kind: 'nav' as const,
    group: 'Go to',
    title: t.title,
    subtitle: 'Finance',
    href: `/admin/finance?tab=${t.tab}`,
    keywords: t.keywords,
  }))

  // /admin/finance/overview appears in both the sidebar nav and the Finance
  // subnav list — de-dupe by id, last one in (the subnav's "Overzicht"
  // framing) wins.
  const byId = new Map<string, PaletteItem>()
  for (const item of [...fromSidebar, ...fromFinanceSubnav, ...fromKasboekTabs]) {
    byId.set(item.id, item)
  }
  return [...byId.values()]
}
