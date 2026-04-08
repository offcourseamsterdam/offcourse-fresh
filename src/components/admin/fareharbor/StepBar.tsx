'use client'

import { Check, ChevronRight } from 'lucide-react'

interface StepBarProps {
  step: number
}

export function StepBar({ step }: StepBarProps) {
  const steps = ['Date & Listings', 'Time & Duration', 'Guest Info', 'Extras', 'Payment', 'Confirmation']
  return (
    <div className="flex items-center gap-2 mb-8 flex-wrap">
      {steps.map((label, i) => {
        const n = i + 1
        const done = step > n
        const active = step === n
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 ${active ? 'text-zinc-900' : done ? 'text-emerald-600' : 'text-zinc-300'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                done ? 'bg-emerald-600 text-white' : active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'
              }`}>
                {done ? <Check className="w-3 h-3" /> : n}
              </div>
              <span className={`text-sm font-medium hidden sm:block ${active ? '' : done ? '' : 'text-zinc-300'}`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-200 flex-shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}
