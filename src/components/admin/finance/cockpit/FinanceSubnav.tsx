'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'

interface SubnavItem {
  href: string
  label: string
  /** Greyed-out placeholder for a later phase. */
  soon?: boolean
}

/**
 * Order matters: the cockpit pages first (what can happen next), then the
 * existing kasboek (what happened), then the phases that aren't built yet.
 */
const ITEMS: SubnavItem[] = [
  { href: '/admin/finance/overview', label: 'Overzicht' },
  { href: '/admin/finance/goals', label: 'Doelen' },
  { href: '/admin/finance/loans', label: 'Leningen' },
  { href: '/admin/finance', label: 'Kasboek' },
  { href: '/admin/finance/inbox', label: 'Inbox', soon: true },
  { href: '/admin/finance/transactions', label: 'Transacties', soon: true },
  { href: '/admin/finance/investments', label: 'Investeringen', soon: true },
]

/**
 * Horizontal pill navigation shared by every /admin/finance/* page.
 * Scrolls sideways on narrow screens instead of wrapping, so the row stays
 * one line high and never pushes the page wider than the viewport.
 */
export function FinanceSubnav() {
  const params = useParams()
  const locale = (params?.locale as string | undefined) ?? 'en'
  const pathname = usePathname() ?? ''

  // Strip the locale prefix so '/nl/admin/finance/goals' matches '/admin/finance/goals'.
  const current = pathname.replace(/^\/[a-z]{2}(?=\/)/, '')

  return (
    <nav aria-label="Finance" className="-mx-4 sm:mx-0 overflow-x-auto">
      <ul className="flex items-center gap-2 px-4 sm:px-0 min-w-max">
        {ITEMS.map(item => {
          // '/admin/finance' is the kasboek; only an exact match should light it up.
          const active = item.href === '/admin/finance'
            ? current === item.href
            : current === item.href || current.startsWith(`${item.href}/`)

          if (item.soon) {
            return (
              <li key={item.href}>
                <span
                  aria-disabled="true"
                  className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 rounded-full border border-dashed border-zinc-200 text-sm text-zinc-400 select-none cursor-default whitespace-nowrap"
                >
                  {item.label}
                  <span className="text-[10px] uppercase tracking-wide text-zinc-300">binnenkort</span>
                </span>
              </li>
            )
          }

          return (
            <li key={item.href}>
              <Link
                href={`/${locale}${item.href}`}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center min-h-[44px] sm:min-h-0 px-3.5 py-2 rounded-full border text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
