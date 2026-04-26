'use client'

import { useState } from 'react'
import Link from 'next/link'
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
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: string
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
}

export default function DashboardSidebar({
  locale,
  profile,
  portalName,
  navSections,
}: DashboardSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const initials = (profile.display_name || profile.email)
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  function toggle(label: string) {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-zinc-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-5">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-0.5">
          Off Course
        </p>
        <p className="text-sm font-semibold text-zinc-900">{portalName}</p>
      </div>

      <Separator />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
        {navSections.map(section => {
          const isCollapsed = !!collapsed[section.label]
          return (
            <div key={section.label}>
              <button
                onClick={() => toggle(section.label)}
                className="w-full flex items-center justify-between px-3 mb-1 group"
              >
                <span className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 group-hover:text-zinc-600 transition-colors">
                  {section.label}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-zinc-300 group-hover:text-zinc-500 transition-all ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>

              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {section.items.map(item => {
                    const Icon = ICON_MAP[item.icon] ?? LayoutDashboard
                    if (item.comingSoon) {
                      return (
                        <li key={item.href}>
                          <span className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-300 cursor-default select-none">
                            <Icon className="w-4 h-4 text-zinc-200 flex-shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            <Clock className="w-3 h-3 text-zinc-300 flex-shrink-0" />
                          </span>
                        </li>
                      )
                    }
                    return (
                      <li key={item.href}>
                        <Link
                          href={`/${locale}${item.href}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors group"
                        >
                          <Icon className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 transition-colors flex-shrink-0" />
                          {item.label}
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
      <div className="px-3 py-4 space-y-3">
        <div className="flex items-center gap-3 px-3">
          <div className="w-8 h-8 rounded-full bg-zinc-900 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 truncate">
              {profile.display_name || profile.email}
            </p>
            <p className="text-xs text-zinc-400 capitalize">{profile.role}</p>
          </div>
        </div>
        <AdminSignOutButton locale={locale} />
      </div>
    </aside>
  )
}
