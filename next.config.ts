import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Security headers applied to every response.
// Deliberately excludes a Content-Security-Policy for now — CSP with Next.js App Router
// (inline RSC scripts) + Stripe Elements (requires js.stripe.com frames) needs a nonce
// strategy or careful per-page exceptions; an incomplete CSP is worse than none.
// Add CSP as a dedicated change once nonce infrastructure is in place.
const securityHeaders = [
  // Prevent this site from being embedded in iframes (clickjacking protection).
  // Does NOT affect Stripe Elements — those iframes are served FROM stripe.com,
  // so stripe.com's headers control them, not ours.
  { key: 'X-Frame-Options', value: 'DENY' },

  // Prevent browsers from MIME-sniffing a response away from its declared Content-Type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Send full URL as Referer only for same-origin; only origin for cross-origin HTTPS.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Disable browser features this site doesn't use (reduces attack surface).
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },

  // Instruct browsers to use HTTPS for 2 years + include subdomains.
  // Browsers ignore this on non-HTTPS origins (local dev), so it's safe to send always.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

// Derive the WordPress media host from WORDPRESS_URL so next/image can optimise
// featured images served from the headless CMS. If unset (WP not configured yet),
// this is simply skipped and no WP image pattern is added.
const wpImageHost = (() => {
  const raw = process.env.WORDPRESS_URL
  if (!raw) return null
  try {
    return new URL(raw).hostname
  } catch {
    return null
  }
})()

const nextConfig: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fkylzllxvepmrtqxisrn.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        // Google author avatars come from lh3/lh4/lh5/lh6.googleusercontent.com
        hostname: '*.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.offcourseamsterdam.com',
      },
      {
        protocol: 'https',
        hostname: 'withlocals-com-res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'offcourseamsterdam.com',
      },
      // WordPress (WP SEO AI) media host — added only when WORDPRESS_URL is set.
      ...(wpImageHost ? [{ protocol: 'https' as const, hostname: wpImageHost }] : []),
    ],
  },
}

export default withNextIntl(nextConfig)
