import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// ── Custom fonts via next/font ─────────────────────────────────────────────
// next/font/local automatically: preloads each font in <head>, sets optimal
// cache-control headers, and injects CSS variables for use in globals.css.
// Fonts are converted to WOFF2 (64-68% smaller than the original TTFs).
// Only Briston + Avenir are preloaded — they appear above the fold.
// Palmore is below the fold (price display) so preload=false avoids wasted
// bandwidth on pages where it might not appear.

const briston = localFont({
  src: '../../public/fonts/Briston_Regular.woff2',
  variable: '--font-briston',
  display: 'swap',
  preload: true,
})

const palmore = localFont({
  src: '../../public/fonts/Palmore_Regular.woff2',
  variable: '--font-palmore',
  display: 'swap',
  preload: false,
})

const avenir = localFont({
  src: [
    { path: '../../public/fonts/AvenirNext_Bold.woff2', weight: '700' },
    { path: '../../public/fonts/AvenirNext_Light.woff2', weight: '300' },
  ],
  variable: '--font-avenir',
  display: 'swap',
  preload: true,
})

export const metadata: Metadata = {
  title: {
    default: 'Off Course Amsterdam — Your Friend with a Boat',
    template: '%s | Off Course Amsterdam',
  },
  description:
    "Electric canal cruises through Amsterdam's hidden gems. Private & shared boat tours — the real Amsterdam, no pretension.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'),
  openGraph: {
    siteName: 'Off Course Amsterdam',
    locale: 'en_US',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html suppressHydrationWarning className={`${briston.variable} ${palmore.variable} ${avenir.variable}`}>
      <body>{children}</body>
    </html>
  )
}
