'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Segment error boundary for everything under /[locale]. Catches uncaught render
 * errors in public pages, admin, checkout, etc. and shows a branded recovery UI
 * (with the normal nav/footer chrome) instead of the raw Next.js error screen.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Bare console for now; this is the hook point for a real error tracker (Sentry).
    console.error('Segment error boundary caught:', error)
  }, [error])

  return (
    <main className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6 py-20">
      <p className="text-xs uppercase tracking-widest text-accent mb-4">Off Course</p>
      <h1 className="text-3xl sm:text-4xl text-primary mb-3">Well, this is awkward.</h1>
      <p className="max-w-md text-muted leading-relaxed mb-8">
        Something drifted off course. Give it another go — and if it keeps happening, that&apos;s on
        us, not you.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={reset}
          className="bg-cta text-ink rounded-full px-7 py-3 hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full px-7 py-3 border border-border text-ink hover:bg-white/50 transition-colors"
        >
          Back home
        </Link>
      </div>
      {error?.digest && <p className="mt-8 text-xs text-muted">Reference: {error.digest}</p>}
    </main>
  )
}
