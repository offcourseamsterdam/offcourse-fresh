export function CheckoutProgress({ step, hidePayment = false }: { step: 'details' | 'payment'; hidePayment?: boolean }) {
  const steps = hidePayment
    ? [{ key: 'cruise', label: 'Cruise' }, { key: 'details', label: 'Details' }] as const
    : [{ key: 'cruise', label: 'Cruise' }, { key: 'details', label: 'Details' }, { key: 'payment', label: 'Payment' }] as const

  const activeIndex = step === 'details' ? 1 : 2

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const isDone = i < activeIndex
        const isActive = i === activeIndex
        return (
          <div key={s.key} className="flex items-center gap-0 flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${isDone ? 'bg-[var(--color-primary)] text-white' : isActive ? 'bg-[var(--color-primary)] text-white ring-4 ring-[var(--color-primary)]/20' : 'bg-zinc-100 text-zinc-400'}`}>
                {isDone ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${isActive ? 'text-zinc-900' : isDone ? 'text-[var(--color-primary)]' : 'text-zinc-400'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mx-2 mb-4 transition-colors ${isDone ? 'bg-[var(--color-primary)]' : 'bg-zinc-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
