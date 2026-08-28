'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { GrowthMonth } from '@/app/[locale]/admin/reviews/monthly-stats'
import { PLATFORM_LABEL } from '@/lib/reviews/platform-labels'

const PLATFORM_COLOR: Record<string, string> = {
  google: '#f59e0b',
  tripadvisor: '#22c55e',
  withlocals: '#6366f1',
  getyourguide: '#3b82f6',
}

interface ReviewsGrowthChartProps {
  months: GrowthMonth[]
}

/** Stacked monthly review volume by platform — how many are coming in, and from where (Beer, 2026-08-23). */
export function ReviewsGrowthChart({ months }: ReviewsGrowthChartProps) {
  const sources = [...new Set(months.flatMap(m => Object.keys(m.bySource)))]
  const data = months.map(m => ({ label: m.label, ...m.bySource }))

  if (!sources.length) {
    return (
      <div className="flex items-center justify-center h-56 text-sm text-zinc-400">
        No reviews yet over this period
      </div>
    )
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: '#18181b', border: 'none', borderRadius: 8, fontSize: 12, color: '#fafafa', padding: '8px 12px' }}
            itemStyle={{ color: '#fafafa' }}
            labelStyle={{ color: '#a1a1aa', marginBottom: 4 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value: string) => PLATFORM_LABEL[value] ?? value} />
          {sources.map(source => (
            <Bar key={source} dataKey={source} stackId="reviews" fill={PLATFORM_COLOR[source] ?? '#a1a1aa'} name={source} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
