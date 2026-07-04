import { Check, Loader2 } from 'lucide-react'

type StepState = 'done' | 'active' | 'upcoming'

interface Step {
  label: string
  hint?: string
  state: StepState
}

function StepRow({ step }: { step: Step }) {
  const isDone = step.state === 'done'
  const isActive = step.state === 'active'
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
          isDone
            ? 'bg-emerald-500 text-white'
            : isActive
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-zinc-200 text-zinc-400'
        }`}
      >
        {isDone ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : isActive ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>
      <span className="leading-tight">
        <span className={`block text-sm font-medium ${isDone || isActive ? 'text-zinc-800' : 'text-zinc-400'}`}>
          {step.label}
        </span>
        {step.hint && (
          <span className={`block text-xs ${isActive ? 'text-zinc-500' : 'text-zinc-400'}`}>{step.hint}</span>
        )}
      </span>
    </li>
  )
}

/**
 * The post-payment lifecycle, shown to the customer so they always know exactly
 * what has happened and what to wait for — never a bare error.
 *
 * - 'confirmed': everything is done (booking row exists, email sent).
 * - 'pending':  payment is in, the booking is being finalised (webhook still
 *               running), the email follows once it lands.
 */
export function BookingProgressSteps({
  stage,
  email,
}: {
  stage: 'pending' | 'confirmed'
  email?: string | null
}) {
  const steps: Step[] =
    stage === 'confirmed'
      ? [
          { label: 'Payment received', state: 'done' },
          { label: 'Boat reserved & booking confirmed', state: 'done' },
          {
            label: 'Confirmation email sent',
            hint: email ? `to ${email}` : undefined,
            state: 'done',
          },
        ]
      : [
          { label: 'Payment received', state: 'done' },
          {
            label: 'Confirming your booking',
            hint: 'reserving your boat — this can take up to a minute',
            state: 'active',
          },
          {
            label: 'Confirmation email',
            hint: 'arrives the moment your booking is confirmed',
            state: 'upcoming',
          },
        ]

  return (
    <ol className="space-y-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4">
      {steps.map((s, i) => (
        <StepRow key={i} step={s} />
      ))}
    </ol>
  )
}
