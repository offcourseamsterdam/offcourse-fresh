'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface ChannelBarChartProps {
  data: { name: string; sessions: number; color: string | null }[]
}

export function ChannelBarChart({ data }: ChannelBarChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-zinc-400">
        No channel data
      </div>
    )
  }

  // Sort by sessions descending
  const sorted = [...data].sort((a, b) => b.sessions - a.sessions).slice(0, 8)

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis type="number" tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: '#71717a' }}
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              color: '#fafafa',
              padding: '8px 12px',
            }}
            cursor={{ fill: '#f4f4f5' }}
          />
          <Bar dataKey="sessions" radius={[0, 4, 4, 0]} name="Sessions">
            {sorted.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? '#71717a'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
