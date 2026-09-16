'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { preload } from 'swr'
import { adminFetcher, useAdminFetch } from '@/hooks/useAdminFetch'
import AdminSignOutButton from '@/components/auth/AdminSignOutButton'
import { isNavItemActive, stripLocale, type NavSection } from '@/lib/admin/nav-sections'
import type { UserProfile } from '@/lib/auth/types'
import {
  LayoutDashboard,
  Calendar,
  Map,
  Users,
  Ship,
  Star,
  BookOpen,
  Megaphone,
  BarChart2,
  ShieldCheck,
  Plug,
  Network,
  Search,
  ImageIcon,
  ChevronDown,
  ChevronRight,
  Clock,
  Tag,
  Handshake,
  Settings,
  Ticket,
  UtensilsCrossed,
  Receipt,
  Inbox,
  Ghost,
  Wrench,
  Bell,
  Boxes,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Sparkles,
  LogOut,
  Waves,
} from 'lucide-react'

// Types moved to the shared module; re-exported so older imports keep working.
export type { NavItem, NavSection } from '@/lib/admin/nav-sections'

interface DashboardSidebarProps {
  locale: string
  profile: UserProfile
  portalName: string
  navSections: NavSection[]
}

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

const ICON_MAP: Record<string, IconComponent> = {
  dashboard: LayoutDashboard,
  bookings: Calendar,
  catering: UtensilsCrossed,
  planning: Map,
  customers: Users,
  cruises: Ship,
  reviews: Star,
  blog: BookOpen,
  campaigns: Megaphone,
  statistics: BarChart2,
  users: ShieldCheck,
  fareharbor: Plug,
  connections: Network,
  reviewtool: Search,
  images: ImageIcon,
  extras: Tag,
  affiliates: Handshake,
  settings: Settings,
  promocodes: Ticket,
  finance: Receipt,
  inbox: Inbox,
  ghost: Ghost,
  maintenance: Wrench,
  notifications: Bell,
  stock: Boxes,
  schedule: Clock,
  sparkles: Sparkles,
}

const PREFETCH_URLS: Record<string, string> = {
  '/admin/bookings':    '/api/admin/bookings/local',
  '/admin/extras':      '/api/admin/extras',
  '/admin/partners':    '/api/admin/partners',
  '/admin/reviews':     '/api/admin/reviews',
  '/admin/cruises':     '/api/admin/cruise-listings',
  '/admin/promo-codes': '/api/admin/promo-codes',
  '/admin/finance':     '/api/admin/finance/partners-summary',
  '/admin/inbox':       '/api/admin/inbox/conversations?status=open',
  '/admin/catering':    '/api/admin/catering',
  '/admin/planning':    '/api/admin/bookings/local',
  '/admin/maintenance': '/api/admin/maintenance',
  '/admin/stock':       '/api/admin/stock',
}

const RAIL_STORAGE_KEY = 'admin:sidebar-collapsed'

export default function DashboardSidebar({
  locale,
  profile,
  portalName,
  navSections,
}: DashboardSidebarProps) {
  const pathname = usePathname()
  const currentPath = stripLocale(pathname, locale)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  // Whole-sidebar collapse (icon rail) — a desktop density preference, persisted.
  // Starts expanded on the server render; the saved preference is applied after
  // mount to avoid a hydration mismatch.
  const [rail, setRail] = useState(false)
  // Mobile off-canvas drawer — closed by default, toggled by the hamburger
  // button. Irrelevant on lg+ screens, where the sidebar is always visible.
  const [mobileOpen, setMobileOpen] = useState(false)
  // The rail (icon-only) density is a desktop screen-real-estate optimization —
  // meaningless once the sidebar is a full-width mobile drawer, so the drawer
  // always shows full labels regardless of the saved desktop preference.
  const displayRail = rail && !mobileOpen
  const [query, setQuery] = useState('')
  const { data: cateringPending } = useAdminFetch<{ count: number }>('/api/admin/catering/pending-count')
  const pendingCateringCount = cateringPending?.count ?? 0
  const { data: inboxOpen } = useAdminFetch<{ count: number }>('/api/admin/inbox/open-count', {
    refreshInterval: 30_000,
  })
  const inboxOpenCount = inboxOpen?.count ?? 0
  const { data: financeInboxOpen } = useAdminFetch<{ count: number }>('/api/admin/inbox/open-count?scope=finance', {
    refreshInterval: 30_000,
  })
  const financeInboxOpenCount = financeInboxOpen?.count ?? 0

  useEffect(() => {
    // localStorage isn't available during SSR — this must run post-mount to avoid
    // a hydration mismatch against the server's default-expanded render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRail(localStorage.getItem(RAIL_STORAGE_KEY) === '1')
  }, [])

  function toggleRail() {
    setRail(prev => {
      localStorage.setItem(RAIL_STORAGE_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  const initials = (profile.display_name || profile.email)
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  function toggleSection(label: string) {
    setCollapsedSections(prev => ({ ...prev, [label]: !prev[label] }))
  }

  const trimmedQuery = query.trim().toLowerCase()
  const visibleSections = useMemo(() => {
    if (!trimmedQuery) return navSections
    return navSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => item.label.toLowerCase().includes(trimmedQuery)),
      }))
      .filter(section => section.items.length > 0)
  }, [navSections, trimmedQuery])

  return (
    <>
      {/* Mobile hamburger trigger — the sidebar itself is off-canvas below lg,
          so this floats independently of it. Hidden once the drawer is open
          (the drawer gets its own close button). */}
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="lg:hidden fixed top-3 right-3 z-30 w-11 h-11 rounded-full shadow-md flex items-center justify-center text-white"
          style={{ backgroundColor: 'var(--admin-navy)' }}
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Backdrop — tap outside the drawer to close it. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:relative lg:inset-auto lg:z-auto lg:translate-x-0 lg:transition-[width] ${
          displayRail ? 'lg:w-16' : 'lg:w-60'
        } h-screen flex flex-col flex-shrink-0`}
        style={{ backgroundColor: 'var(--admin-navy)' }}
      >
        {/* Brand */}
        <div className={`flex items-center gap-2.5 py-4 ${displayRail ? 'justify-center px-2' : 'px-3'}`}>
          {!displayRail && (
            <>
              <div
                className="w-8 h-8 rounded-[9px] flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'var(--color-yellow)' }}
              >
                <Waves className="w-[18px] h-[18px]" style={{ color: 'var(--admin-navy)' }} />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-bold text-white tracking-tight truncate">Off Course</span>
                <span className="text-[11px] truncate" style={{ color: 'var(--admin-navy-icon)' }}>{portalName}</span>
              </div>
            </>
          )}
          {/* Mobile: close the drawer. Desktop: the rail density toggle. */}
          <button
            onClick={() => (mobileOpen ? setMobileOpen(false) : toggleRail())}
            title={mobileOpen ? 'Close menu' : rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={mobileOpen ? 'Close menu' : rail ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 transition-colors hover:bg-white/10"
            style={{ color: 'var(--admin-navy-icon)' }}
          >
            {mobileOpen ? (
              <X className="w-4 h-4" />
            ) : rail ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Search — filters the nav below */}
        {!displayRail && (
          <div className="px-3 pb-3">
            <label
              className="flex items-center gap-2 h-9 px-2.5 rounded-lg text-[13px]"
              style={{ backgroundColor: 'var(--admin-navy-active)', color: 'var(--admin-navy-icon)' }}
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search admin navigation"
                className="flex-1 min-w-0 bg-transparent outline-none text-white placeholder:text-[color:var(--admin-navy-icon)]"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="flex-shrink-0 hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </label>
          </div>
        )}

        {/* Nav */}
        <nav className={`flex-1 min-h-0 pb-4 overflow-y-auto ${displayRail ? 'px-2 space-y-3' : 'px-3 space-y-3.5'}`}>
          {visibleSections.length === 0 && (
            <p className="px-2 text-xs" style={{ color: 'var(--admin-navy-icon)' }}>
              No pages match &ldquo;{query}&rdquo;.
            </p>
          )}
          {visibleSections.map((section, sectionIdx) => {
            // A search shows every match, even inside a group the user folded away.
            const isCollapsed = !displayRail && !trimmedQuery && !!collapsedSections[section.label]
            return (
              <div key={section.label}>
                {displayRail ? (
                  // Icon rail: a thin divider stands in for the section header
                  sectionIdx > 0 && <div className="border-t mb-3" style={{ borderColor: 'var(--admin-navy-active)' }} />
                ) : (
                  <button
                    onClick={() => toggleSection(section.label)}
                    className="w-full flex items-center gap-1.5 px-2 mb-1"
                  >
                    <span className="w-1.5 h-1.5 rounded-[2px] flex-shrink-0" style={{ backgroundColor: section.color }} />
                    <span
                      className="flex-1 text-left text-[11px] font-semibold tracking-widest uppercase"
                      style={{ color: 'var(--admin-navy-label)' }}
                    >
                      {section.label}
                    </span>
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3" style={{ color: 'var(--admin-navy-label)' }} />
                    ) : (
                      <ChevronDown className="w-3 h-3" style={{ color: 'var(--admin-navy-label)' }} />
                    )}
                  </button>
                )}

                {!isCollapsed && (
                  <ul className="space-y-0.5">
                    {section.items.map(item => {
                      const Icon = ICON_MAP[item.icon] ?? LayoutDashboard
                      if (item.comingSoon) {
                        return (
                          <li key={item.href}>
                            <span
                              title={displayRail ? `${item.label} (coming soon)` : undefined}
                              className={`flex items-center rounded-md text-[13.5px] cursor-default select-none ${displayRail ? 'justify-center p-2' : 'gap-2.5 px-2.5 py-2'}`}
                              style={{ color: 'var(--admin-navy-soon)' }}
                            >
                              <Icon className="w-4 h-4 flex-shrink-0" />
                              {!displayRail && (
                                <>
                                  <span className="flex-1">{item.label}</span>
                                  <span className="text-[10px] font-semibold tracking-wide">SOON</span>
                                </>
                              )}
                            </span>
                          </li>
                        )
                      }
                      const active = isNavItemActive(item, currentPath)
                      const badgeCount =
                        item.badge === 'pending-catering-count'
                          ? pendingCateringCount
                          : item.badge === 'inbox-open-count'
                            ? inboxOpenCount
                            : item.badge === 'finance-inbox-open-count'
                              ? financeInboxOpenCount
                              : 0
                      return (
                        <li key={item.href}>
                          <Link
                            href={`/${locale}${item.href}`}
                            title={displayRail ? item.label : undefined}
                            aria-current={active ? 'page' : undefined}
                            onMouseEnter={() => {
                              const url = PREFETCH_URLS[item.activePrefix ?? item.href]
                              if (url) preload(url, adminFetcher)
                            }}
                            onClick={() => setMobileOpen(false)}
                            className={`relative flex items-center rounded-md text-[13.5px] transition-colors ${
                              active ? 'font-semibold text-white' : 'font-medium hover:bg-white/5 hover:text-white'
                            } ${displayRail ? 'justify-center p-2' : 'gap-2.5 px-2.5 py-2'}`}
                            style={{
                              backgroundColor: active ? 'var(--admin-navy-active)' : undefined,
                              color: active ? undefined : 'var(--admin-navy-text)',
                            }}
                          >
                            {/* Section-colored marker on the page you're on */}
                            {active && !displayRail && (
                              <span
                                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r"
                                style={{ backgroundColor: section.color }}
                              />
                            )}
                            <Icon
                              className="w-4 h-4 flex-shrink-0"
                              style={{ color: active ? section.color : 'var(--admin-navy-icon)' }}
                            />
                            {displayRail ? (
                              badgeCount > 0 && (
                                <span
                                  className="absolute top-1 right-1 w-2 h-2 rounded-full"
                                  style={{ backgroundColor: 'var(--color-pink)' }}
                                />
                              )
                            ) : (
                              <>
                                <span className="flex-1 truncate">{item.label}</span>
                                {badgeCount > 0 && (
                                  <span
                                    className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center leading-none flex-shrink-0"
                                    style={{ backgroundColor: 'var(--color-yellow)', color: 'var(--admin-navy)' }}
                                  >
                                    {badgeCount > 99 ? '99+' : badgeCount}
                                  </span>
                                )}
                              </>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>

        {/* User footer */}
        <div
          className={`py-3 border-t ${displayRail ? 'px-2' : 'px-3'}`}
          style={{ borderColor: 'var(--admin-navy-active)' }}
        >
          <div className={`flex items-center ${displayRail ? 'justify-center' : 'gap-2.5 px-1'}`}>
            <div
              title={displayRail ? `${profile.display_name || profile.email} — expand sidebar to sign out` : undefined}
              className="w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'var(--color-lime)', color: 'var(--admin-navy)' }}
            >
              {initials}
            </div>
            {!displayRail && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white truncate">
                    {profile.display_name || profile.email}
                  </p>
                  <p className="text-[11px] capitalize" style={{ color: 'var(--admin-navy-icon)' }}>{profile.role}</p>
                </div>
                <AdminSignOutButton
                  locale={locale}
                  iconOnly
                  className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 transition-colors hover:bg-white/10"
                  style={{ color: 'var(--admin-navy-icon)' }}
                >
                  <LogOut className="w-4 h-4" />
                </AdminSignOutButton>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
