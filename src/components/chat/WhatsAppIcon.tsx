/**
 * WhatsApp's glyph — not in lucide-react (a generic icon set, no brand logos),
 * and not worth a whole icon-library dependency for one mark. Single inline
 * path, fill=currentColor so it inherits color/sizing like any lucide icon.
 */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.45 1.28 4.93L2 22l5.2-1.36A9.94 9.94 0 0 0 12.04 22c5.52 0 10-4.48 10-10s-4.48-10-10-10zm0 18.15a8.1 8.1 0 0 1-4.14-1.13l-.3-.18-3.09.81.82-3-.19-.31a8.13 8.13 0 1 1 6.9 3.81zm4.46-6.08c-.24-.12-1.43-.71-1.66-.79-.22-.08-.38-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.19-.71-.63-1.19-1.41-1.33-1.65-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.81-.2-.48-.4-.41-.55-.42-.14-.01-.3-.01-.46-.01a.9.9 0 0 0-.65.3c-.22.24-.85.83-.85 2.03s.87 2.35 1 2.51c.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.43-.58 1.63-1.15.2-.56.2-1.04.14-1.15-.06-.1-.22-.16-.46-.28z" />
    </svg>
  )
}
