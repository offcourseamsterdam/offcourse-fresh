import type { Metadata } from 'next'
import './globals.css'

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
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
