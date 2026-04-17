'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface TrafficChartProps {
  data: { date: string; sessions: number; bookings: number }[]
}

export function TrafficChart({ data }: TrafficChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-zinc-400">
        No data for this period
      </div>
    )
  }

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="sessionFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#71717a" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#71717a" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="bookingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              color: '#fafafa',
              padding: '8px 12px',
            }}
            itemStyle={{ color: '#fafafa' }}
            labelStyle={{ color: '#a1a1aa', marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="sessions"
            stroke="#71717a"
            strokeWidth={2}
            fill="url(#sessionFill)"
            name="Sessions"
          />
          <Area
            type="monotone"
            dataKey="bookings"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#bookingFill)"
            name="Bookings"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
