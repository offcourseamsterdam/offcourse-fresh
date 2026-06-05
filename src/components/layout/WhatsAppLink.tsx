'use client'

import { trackWhatsAppClick, type WhatsAppSource } from '@/lib/tracking/client'

const WHATSAPP_URL = 'https://wa.me/31645351618'

/**
 * A WhatsApp link that records the tap in our first-party tracking
 * (event `whatsapp_click`, counted once per session per source).
 *
 * Use this anywhere outside the floating bubble — e.g. the footer — so the
 * surrounding component can stay a server component while the click still
 * gets tracked.
 */
export function WhatsAppLink({
  source,
  className,
  children,
}: {
  source: WhatsAppSource
  className?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackWhatsAppClick(source)}
      className={className}
    >
      {children}
    </a>
  )
}
