'use client'

import { useState } from 'react'
import { StaffTab } from './StaffTab'

/**
 * Scheduling hub. Staff tab is live (M1); Shifts (M2) and Payroll (M5)
 * land here as the build progresses — the tab bar is the one piece of
 * chrome they all share.
 */

const TABS = [
  { key: 'staff', label: 'Staff', ready: true },
  { key: 'shifts', label: 'Shifts', ready: false },
  { key: 'payroll', label: 'Payroll', ready: false },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function AdminSchedulingPage() {
  const [tab, setTab] = useState<TabKey>('staff')

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Scheduling</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Who runs which cruise — staff, shifts, and hours.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-zinc-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => t.ready && setTab(t.key)}
            disabled={!t.ready}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors min-h-[44px] ${
              tab === t.key
                ? 'border-zinc-900 text-zinc-900'
                : t.ready
                  ? 'border-transparent text-zinc-500 hover:text-zinc-700'
                  : 'border-transparent text-zinc-300 cursor-not-allowed'
            }`}
          >
            {t.label}
            {!t.ready && <span className="ml-1.5 text-[10px] text-zinc-300">soon</span>}
          </button>
        ))}
      </div>

      {tab === 'staff' && <StaffTab />}
    </div>
  )
}
