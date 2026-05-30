'use client'

import { useEffect } from 'react'

/**
 * Catastrophic fallback: catches errors thrown by the ROOT layout itself, where
 * there's no surrounding <html>/<body> to rely on. Uses inline styles only — it
 * must not depend on CSS/fonts that could be the very thing that failed.
 *
 * Most errors are caught by the nearer segment boundary (app/[locale]/error.tsx);
 * this only fires for truly top-level failures.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Hook point for a real error tracker (e.g. Sentry) — same as [locale]/error.tsx.
    console.error('Root error boundary caught:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          background: '#f5f0e8',
          color: '#1f2937',
        }}
      >
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#990000',
              margin: '0 0 1rem',
            }}
          >
            Off Course
          </p>
          <h1 style={{ fontSize: '2rem', color: '#343499', margin: '0 0 0.75rem' }}>
            Well, this is awkward.
          </h1>
          <p style={{ maxWidth: '28rem', lineHeight: 1.6, color: '#6b7280', margin: '0 0 2rem' }}>
            Something drifted off course on our end. It&apos;s not you — give it another go, and if
            it keeps happening, we&apos;ll get it sorted.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#9bb7fd',
              color: '#1f2937',
              border: 'none',
              borderRadius: '9999px',
              padding: '0.75rem 1.75rem',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error?.digest && (
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#9ca3af' }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
