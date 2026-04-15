'use client'

import { ArrowUp, ArrowDown } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string
  delta?: number // percentage change vs previous period
  subtitle?: string
}

export function KPICard({ label, value, delta, subtitle }: KPICardProps) {
  const isPositive = delta !== undefined && delta >= 0
  const isNeutral = delta === undefined || delta === 0

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-1">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400">
        {label}
      </p>
      <p className="text-2xl sm:text-3xl font-bold text-zinc-900 tabular-nums">
        {value}
      </p>
      <div className="flex items-center gap-2">
        {!isNeutral && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {Math.abs(delta!).toFixed(1)}%
          </span>
        )}
        {subtitle && (
          <span className="text-xs text-zinc-400">{subtitle}</span>
        )}
      </div>
    </div>
  )
}
