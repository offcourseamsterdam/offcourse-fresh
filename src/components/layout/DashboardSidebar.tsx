'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { preload } from 'swr'
import { adminFetcher, useAdminFetch } from '@/hooks/useAdminFetch'
import AdminSignOutButton from '@/components/auth/AdminSignOutButton'
import { Separator } from '@/components/ui/separator'
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
  Clock,
  Tag,
  Handshake,
  Settings,
  Ticket,
  UtensilsCrossed,
  Receipt,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: string
  badge?: 'pending-catering-count'
  comingSoon?: boolean
}

export interface NavSection {
  label: string
  items: NavItem[]
}

interface DashboardSidebarProps {
  locale: string
  profile: UserProfile
  portalName: string
  navSections: NavSection[]
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
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
}

const PREFETCH_URLS: Record<string, string> = {
  '/admin/bookings':    '/api/admin/bookings/local',
  '/admin/extras':      '/api/admin/extras',
  '/admin/partners':    '/api/admin/partners',
  '/admin/reviews':     '/api/admin/reviews',
  '/admin/cruises':     '/api/admin/cruise-listings',
  '/admin/promo-codes': '/api/admin/promo-codes',
  '/admin/finance':     '/api/admin/finance/partners-summary',
}

const RAIL_STORAGE_KEY = 'admin:sidebar-collapsed'

export default function DashboardSidebar({
  locale,
  profile,
  portalName,
  navSections,
}: DashboardSidebarProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  // Whole-sidebar collapse (icon rail). Starts expanded on the server render;
  // the saved preference is applied after mount to avoid a hydration mismatch.
  const [rail, setRail] = useState(false)
  const { data: cateringPending } = useAdminFetch<{ count: number }>('/api/admin/catering/pending-count')
  const pendingCateringCount = cateringPending?.count ?? 0

  useEffect(() => {
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

  return (
    <aside className={`${rail ? 'w-16' : 'w-60'} min-h-screen bg-white border-r border-zinc-200 flex flex-col transition-[width] duration-200`}>
      {/* Header */}
      <div className={`py-5 flex items-center ${rail ? 'justify-center px-2' : 'justify-between px-4'}`}>
        {!rail && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-0.5">
              Off Course
            </p>
            <p className="text-sm font-semibold text-zinc-900">{portalName}</p>
          </div>
        )}
        <button
          onClick={toggleRail}
          title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          {rail ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <Separator />

      {/* Nav */}
      <nav className={`flex-1 py-4 overflow-y-auto ${rail ? 'px-2 space-y-3' : 'px-3 space-y-4'}`}>
        {navSections.map((section, sectionIdx) => {
          const isCollapsed = !rail && !!collapsedSections[section.label]
          return (
            <div key={section.label}>
              {rail ? (
                // Icon rail: a thin divider stands in for the section header
                sectionIdx > 0 && <div className="border-t border-zinc-100 mb-3" />
              ) : (
                <button
                  onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center justify-between px-3 mb-1 group"
                >
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 group-hover:text-zinc-600 transition-colors">
                    {section.label}
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 text-zinc-300 group-hover:text-zinc-500 transition-all ${isCollapsed ? '-rotate-90' : ''}`}
                  />
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
                            title={rail ? `${item.label} (coming soon)` : undefined}
                            className={`flex items-center rounded-md text-sm text-zinc-300 cursor-default select-none ${rail ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}
                          >
                            <Icon className="w-4 h-4 text-zinc-200 flex-shrink-0" />
                            {!rail && (
                              <>
                                <span className="flex-1">{item.label}</span>
                                <Clock className="w-3 h-3 text-zinc-300 flex-shrink-0" />
                              </>
                            )}
                          </span>
                        </li>
                      )
                    }
                    const badgeCount = item.badge === 'pending-catering-count' ? pendingCateringCount : 0
                    return (
                      <li key={item.href}>
                        <Link
                          href={`/${locale}${item.href}`}
                          title={rail ? item.label : undefined}
                          onMouseEnter={() => {
                            const url = PREFETCH_URLS[item.href]
                            if (url) preload(url, adminFetcher)
                          }}
                          className={`flex items-center rounded-md text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors group ${rail ? 'justify-center p-2 relative' : 'gap-3 px-3 py-2'}`}
                        >
                          <Icon className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 transition-colors flex-shrink-0" />
                          {rail ? (
                            badgeCount > 0 && (
                              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                            )
                          ) : (
                            <>
                              <span className="flex-1">{item.label}</span>
                              {badgeCount > 0 && (
                                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none flex-shrink-0">
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

      <Separator />

      {/* User footer */}
      <div className={`py-4 ${rail ? 'px-2' : 'px-3 space-y-3'}`}>
        <div className={`flex items-center ${rail ? 'justify-center' : 'gap-3 px-3'}`}>
          <div
            title={rail ? `${profile.display_name || profile.email} — expand sidebar to sign out` : undefined}
            className="w-8 h-8 rounded-full bg-zinc-900 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0"
          >
            {initials}
          </div>
          {!rail && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate">
                {profile.display_name || profile.email}
              </p>
              <p className="text-xs text-zinc-400 capitalize">{profile.role}</p>
            </div>
          )}
        </div>
        {!rail && <AdminSignOutButton locale={locale} />}
      </div>
    </aside>
  )
}
