'use client'

interface FunnelStep {
  event: string
  label: string
  count: number
  drop_off_rate: number
}

interface FunnelChartProps {
  steps: FunnelStep[]
}

const STEP_COLORS = [
  'bg-zinc-700',
  'bg-zinc-600',
  'bg-zinc-500',
  'bg-blue-500',
  'bg-blue-400',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-emerald-400',
]

export function FunnelChart({ steps }: FunnelChartProps) {
  const maxCount = Math.max(...steps.map((s) => s.count), 1)
  const nonZeroSteps = steps.filter((s) => s.count > 0 || steps.indexOf(s) < 3) // Always show first 3

  if (steps.every((s) => s.count === 0)) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-zinc-400">
        No funnel data for this period
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {nonZeroSteps.map((step, i) => {
        const widthPercent = maxCount > 0 ? Math.max((step.count / maxCount) * 100, 4) : 4
        const color = STEP_COLORS[i % STEP_COLORS.length]

        return (
          <div key={step.event} className="flex items-center gap-3">
            {/* Label */}
            <div className="w-28 sm:w-36 flex-shrink-0 text-right">
              <span className="text-xs font-medium text-zinc-600">{step.label}</span>
            </div>

            {/* Bar */}
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-7 bg-zinc-50 rounded-md overflow-hidden">
                <div
                  className={`h-full ${color} rounded-md transition-all duration-500 flex items-center px-2`}
                  style={{ width: `${widthPercent}%` }}
                >
                  {widthPercent > 15 && (
                    <span className="text-[10px] font-bold text-white tabular-nums">
                      {step.count.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              {widthPercent <= 15 && (
                <span className="text-xs font-medium text-zinc-500 tabular-nums w-12">
                  {step.count.toLocaleString()}
                </span>
              )}
            </div>

            {/* Drop-off badge */}
            <div className="w-16 flex-shrink-0 text-right">
              {i > 0 && step.drop_off_rate > 0 ? (
                <span className="text-[10px] font-medium text-red-400">
                  -{(step.drop_off_rate * 100).toFixed(0)}%
                </span>
              ) : i === 0 ? (
                <span className="text-[10px] font-medium text-zinc-300">start</span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
