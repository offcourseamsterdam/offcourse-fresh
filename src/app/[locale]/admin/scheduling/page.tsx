'use client'

import { useState } from 'react'
import { StaffTab } from './StaffTab'
import { PayrollTab } from './PayrollTab'
import { AvailabilityTab } from './AvailabilityTab'

/**
 * Availability hub. Staff (M1), Payroll (M5) and the monthly availability
 * roll-call live here. The old Shifts tab (a boat/time grid of who runs
 * which cruise) was deleted — the Planning page's grid + captain overlay
 * covers that now.
 */

const TABS = [
  { key: 'month', label: 'This month', ready: true },
  { key: 'staff', label: 'Staff', ready: true },
  { key: 'payroll', label: 'Payroll', ready: true },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function AdminSchedulingPage() {
  const [tab, setTab] = useState<TabKey>('month')

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Availability</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Your captains — who they are, their rate, and their pay.
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

      {tab === 'month' && <AvailabilityTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'payroll' && <PayrollTab />}
    </div>
  )
}
