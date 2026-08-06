'use client'

import { useEffect, useState } from 'react'
import { sanitizeEmailHtml } from '@/lib/email/sanitize-html'

/**
 * Renders an email's original HTML formatting — UNTRUSTED content straight
 * from Gmail — safely. Sanitizing must happen in the real browser DOM
 * (DOMPurify has no Node/SSR fallback), so this deliberately runs in
 * useEffect rather than during render: a Next.js client component still
 * renders once on the server for the initial HTML, and calling DOMPurify
 * there would break the page, not just this widget.
 */
export function SafeEmailHtml({ html }: { html: string }) {
  const [sanitized, setSanitized] = useState<string | null>(null)

  useEffect(() => {
    setSanitized(sanitizeEmailHtml(html))
  }, [html])

  if (sanitized === null) return null
  return (
    // overflow-x-auto on its own — never the page body — so a wide fixed-
    // layout table (FareHarbor's own templates lean on these) scrolls
    // within this one message instead of silently clipping or blowing out
    // the thread column.
    <div className="safe-email-html max-w-full overflow-x-auto text-sm [&_img]:max-w-full [&_img]:h-auto">
      <div dangerouslySetInnerHTML={{ __html: sanitized }} />
    </div>
  )
}
