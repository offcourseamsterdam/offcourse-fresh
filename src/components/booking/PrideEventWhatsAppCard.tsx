'use client'

import { WhatsAppLink } from '@/components/layout/WhatsAppLink'

/** Direct line for day-of Pride Amsterdam 2026 questions — separate from the general support number. */
const PRIDE_EVENT_WHATSAPP_NUMBER = '31616679753'

export function PrideEventWhatsAppCard() {
  return (
    <WhatsAppLink
      source="pride_booking_panel"
      phone={PRIDE_EVENT_WHATSAPP_NUMBER}
      message="Hi! I have a question about the Pride Amsterdam 2026 cruise."
      className="mt-4 flex items-center gap-3 bg-white rounded-2xl shadow-lg border border-zinc-100 p-4 hover:border-[#25D366]/50 transition-colors"
    >
      <span className="flex-shrink-0 w-10 h-10 rounded-full bg-[#25D366]/10 flex items-center justify-center text-[#128C7E]">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.118.553 4.107 1.522 5.83L0 24l6.335-1.492A11.956 11.956 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.013-1.376l-.36-.214-3.726.977.997-3.645-.234-.374A9.772 9.772 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-ink)]">Questions about the Pride cruise?</p>
        <p className="text-xs text-[var(--color-muted)]">Chat with us on WhatsApp</p>
      </div>
    </WhatsAppLink>
  )
}
