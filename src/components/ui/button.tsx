import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // bg/fg/border read from --ui-button-* custom properties, which default to
        // these exact zinc values everywhere — so the public site (which never sets
        // them) is unaffected — and are overridden under [data-admin] in globals.css
        // to the navy admin theme. One place to repaint every admin button.
        default: 'bg-[var(--ui-button-bg,#18181b)] text-[var(--ui-button-fg,#fafafa)] shadow hover:bg-[var(--ui-button-bg-hover,#27272a)]',
        destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
        outline: 'border border-[var(--ui-button-border,#e4e4e7)] bg-white shadow-sm hover:bg-zinc-50 hover:text-zinc-900',
        secondary: 'bg-zinc-100 text-zinc-900 shadow-sm hover:bg-zinc-200',
        ghost: 'hover:bg-zinc-100 hover:text-zinc-900',
        link: 'text-zinc-900 underline-offset-4 hover:underline',
        // Brand variants for public site
        primary: 'bg-primary text-white shadow hover:bg-primary-dark',
        brand: 'bg-primary text-white shadow hover:bg-primary-dark',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        md: 'h-10 px-6 py-2.5 rounded-xl text-base',   // public site compat
        lg: 'h-11 rounded-md px-8 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
