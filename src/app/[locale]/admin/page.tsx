import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, Calendar, Ship, Users } from 'lucide-react'

const kpis = [
  { label: 'Bookings today', value: '—', icon: Calendar, change: null },
  { label: 'Revenue this week', value: '—', icon: TrendingUp, change: null },
  { label: 'Upcoming trips', value: '—', icon: Ship, change: null },
  { label: 'Active customers', value: '—', icon: Users, change: null },
]

const quickLinks = [
  { label: 'FareHarbor API Tester', href: 'fareharbor', description: 'Test live availability, items & bookings' },
  { label: 'Manage Users', href: 'users', description: 'Invite team members and manage roles' },
]

export default function AdminDashboardPage() {
  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Welcome back — here's what's happening.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map(kpi => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-zinc-500">{kpi.label}</CardTitle>
                <Icon className="w-4 h-4 text-zinc-400" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-zinc-900">{kpi.value}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Quick links */}
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">Quick access</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {quickLinks.map(link => (
          <a key={link.href} href={link.href}>
            <Card className="hover:bg-zinc-50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">{link.label}</CardTitle>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>

      {/* Status */}
      <div className="mt-8 flex items-center gap-2 text-xs text-zinc-400">
        <Badge variant="success">Live</Badge>
        <span>Connected to FareHarbor · Supabase</span>
      </div>
    </div>
  )
}
