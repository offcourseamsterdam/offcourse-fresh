import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2',
  {
    variants: {
      // Colors here are the admin's own chip palette (Badge has no non-admin
      // callers — grepped before touching this) rather than raw Tailwind
      // emerald/amber/red, so status chips read as one family with the rest
      // of the admin instead of default shadcn colors.
      variant: {
        default: 'border-transparent bg-[#16163a] text-white shadow hover:bg-[#16163a]/90',
        secondary: 'border-transparent bg-[#f0f0f4] text-[#50506a] hover:bg-[#f0f0f4]/80',
        destructive: 'border-transparent bg-[#fde3e9] text-[#9b1c3a] hover:bg-[#fde3e9]/80',
        outline: 'text-[#1a1a2e] border-[#ebe6dc]',
        success: 'border-transparent bg-[#e5f3d6] text-[#3b6614]',
        warning: 'border-transparent bg-[#fff0c2] text-[#7a5800]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
