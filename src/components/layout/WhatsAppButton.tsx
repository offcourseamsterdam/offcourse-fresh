'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'

/** Show admin shortcut on dev/preview domains, hide on the real production domain */
function useShowAdminButton() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const host = window.location.hostname
    const isRealProduction = host === 'offcourseamsterdam.com' || host === 'www.offcourseamsterdam.com'
    setShow(!isRealProduction)
  }, [])
  return show
}

/** Track whether the #booking section is visible (= CTA bar is hidden) */
function useBookingVisible() {
  const [bookingVisible, setBookingVisible] = useState(false)
  useEffect(() => {
    const el = document.getElementById('booking')
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setBookingVisible(entry.isIntersecting),
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return bookingVisible
}

export function WhatsAppButton() {
  const showAdmin = useShowAdminButton()
  const locale = useLocale()
  const bookingVisible = useBookingVisible()

  // On mobile: sit above the CTA bar (84px) when it's showing.
  // When booking section is in view the CTA hides, drop to bottom-6.
  // On desktop (lg+): always bottom-6 (CTA bar is hidden via lg:hidden).
  const bottomClass = bookingVisible
    ? 'bottom-6'
    : 'bottom-[84px] lg:bottom-6'

  return (
    <>
      {showAdmin && (
        <a
          href={`/${locale}/admin`}
          aria-label="Go to admin panel"
          title="Admin panel (dev shortcut)"
          className={`fixed ${bottomClass} right-[52px] z-50 w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-[bottom] duration-300 text-white text-[10px] font-bold`}
        >
          ADM
        </a>
      )}
      <a
        href="https://wa.me/31645351618"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className={`fixed ${bottomClass} right-4 z-50 w-10 h-10 bg-[#25D366] rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-[bottom] duration-300`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="white"
          className="w-5 h-5"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.118.553 4.107 1.522 5.83L0 24l6.335-1.492A11.956 11.956 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.013-1.376l-.36-.214-3.726.977.997-3.645-.234-.374A9.772 9.772 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z" />
        </svg>
      </a>
    </>
  )
}
