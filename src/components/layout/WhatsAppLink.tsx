'use client'

import { trackWhatsAppClick, type WhatsAppSource } from '@/lib/tracking/client'

const DEFAULT_WHATSAPP_NUMBER = '31645351618'

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
  phone = DEFAULT_WHATSAPP_NUMBER,
  message,
  extra,
}: {
  source: WhatsAppSource
  className?: string
  children: React.ReactNode
  /** Override the destination number — e.g. a dedicated partner-inquiries line. */
  phone?: string
  /** Pre-fills the WhatsApp chat's opening message. */
  message?: string
  /** Extra metadata merged into the tracked whatsapp_click event. */
  extra?: Record<string, unknown>
}) {
  const url = `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ''}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackWhatsAppClick(source, extra)}
      className={className}
    >
      {children}
    </a>
  )
}
