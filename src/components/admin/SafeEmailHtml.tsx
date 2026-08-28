'use client'

import { useEffect, useState } from 'react'
import { sanitizeEmailHtml } from '@/lib/email/sanitize-html'
import { stripQuotedReply } from '@/lib/email/strip-quoted-reply'

/**
 * Renders an email's original HTML formatting — UNTRUSTED content straight
 * from Gmail — safely. Sanitizing must happen in the real browser DOM
 * (DOMPurify has no Node/SSR fallback), so this deliberately runs in
 * useEffect rather than during render: a Next.js client component still
 * renders once on the server for the initial HTML, and calling DOMPurify
 * there would break the page, not just this widget.
 *
 * `trustSender` allows this one message's remote images to load (e.g. a
 * GetYourGuide review notification's star-rating graphic and logo) — only
 * pass true once the sender is already known/trusted (see
 * lib/email/trusted-senders.ts), never for an arbitrary customer email.
 */
export function SafeEmailHtml({ html, trustSender }: { html: string; trustSender?: boolean }) {
  const [sanitized, setSanitized] = useState<string | null>(null)

  useEffect(() => {
    setSanitized(stripQuotedReply(sanitizeEmailHtml(html, { allowRemoteImages: trustSender })))
  }, [html, trustSender])

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
