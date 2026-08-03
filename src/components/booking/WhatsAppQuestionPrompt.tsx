'use client'

import { useEffect, useState } from 'react'
import { WhatsAppLink } from '@/components/layout/WhatsAppLink'
import { getAttribution, type AttributionData } from '@/lib/tracking/attribution'

/** Dedicated number for this button — keeps partner-referred inquiries separate from the main support line. */
const PARTNER_WHATSAPP_NUMBER = '31645466270'

/**
 * Builds the pre-filled WhatsApp opening message. When the visitor arrived via
 * a partner/affiliate link (the oc_attr cookie carries a campaign_slug), the
 * message names that affiliate so Beer knows which partner to credit —
 * that's the whole point of the button, not just an FAQ shortcut.
 */
export function buildPrideWhatsAppMessage(campaignSlug?: string | null): string {
  const base = 'Hi! I have a question about the Pride Amsterdam 2026 cruise.'
  return campaignSlug ? `${base} I found you through affiliate ${campaignSlug}.` : base
}

/**
 * Pride-only nudge: this is a whole-boat, high-ticket-price booking, so give
 * people an easy way to ask a question before they commit to it.
 */
export function WhatsAppQuestionPrompt() {
  // Read client-only (cookie access) after mount, not during render — avoids
  // an SSR/hydration mismatch between the server's cookie-less render and the
  // browser's actual attribution state.
  const [attribution, setAttribution] = useState<AttributionData | null>(null)
  useEffect(() => {
    // Cookie read must happen post-mount — see the hydration-mismatch note above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttribution(getAttribution())
  }, [])

  const message = buildPrideWhatsAppMessage(attribution?.campaign_slug)

  return (
    <WhatsAppLink
      source="pride_booking_panel"
      phone={PARTNER_WHATSAPP_NUMBER}
      message={message}
      extra={attribution?.partner_id || attribution?.campaign_slug ? {
        partner_id: attribution?.partner_id,
        campaign_slug: attribution?.campaign_slug,
      } : undefined}
      className="flex items-center justify-center gap-2 w-full rounded-xl border-2 border-[#25D366] bg-[#25D366]/10 py-3 px-4 text-sm font-bold text-[#128C7E] hover:bg-[#25D366]/20 transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 flex-shrink-0">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.118.553 4.107 1.522 5.83L0 24l6.335-1.492A11.956 11.956 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.013-1.376l-.36-.214-3.726.977.997-3.645-.234-.374A9.772 9.772 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z" />
      </svg>
      Got a question? Ask us on WhatsApp
    </WhatsAppLink>
  )
}
