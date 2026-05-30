// Boot-time environment validation.
//
// Validates required env vars the moment this module is first imported.
// If anything is missing the server throws immediately — on first cold start,
// not deep inside a booking/payment request where the error is much harder to debug.
//
// Usage: import { env } from '@/env' in server-side modules.
// New code should use env.STRIPE_SECRET_KEY instead of process.env.STRIPE_SECRET_KEY!
// (the `!` non-null assertion silences TypeScript but can't catch a runtime undefined)

import 'server-only'
import { z } from 'zod'

// zod v4: `required_error` was removed. Required string fields use z.string().min(1).
// For undefined process.env keys, zod produces "Invalid input: expected string" —
// the field path in the formatted error message makes it clear which var is missing.
const envSchema = z.object({
  // ── Supabase ──────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // ── FareHarbor ────────────────────────────────────────────────────────────
  FAREHARBOR_API_APP: z.string().min(1),
  FAREHARBOR_API_USER: z.string().min(1),
  FAREHARBOR_API_BASE: z.string().url().default('https://fareharbor.com/api/v1'),

  // ── Stripe ────────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // ── Site ──────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),

  // ── Optional integrations ─────────────────────────────────────────────────
  // These features degrade gracefully when the key is absent.
  RESEND_API_KEY: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),
  CATERING_EMAIL_RECIPIENT: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  GOOGLE_PLACE_ID: z.string().optional(),

  // Cron job bearer token (Vercel Cron → /api/cron/* routes)
  CRON_SECRET: z.string().optional(),
  // On-demand ISR revalidation (/api/revalidate, /api/fareharbor/sync)
  REVALIDATION_SECRET: z.string().optional(),

  SUPABASE_MANAGEMENT_TOKEN: z.string().optional(),

  // ── Google Ads ────────────────────────────────────────────────────────────
  // All optional: conversion tracking is silently skipped when absent.
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_ADS_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_CONVERSION_ACTION_ID: z.string().optional(),
  GOOGLE_ADS_REQUIRE_CONSENT: z.enum(['true', 'false']).default('true'),
  GOOGLE_ADS_API_VERSION: z.string().optional(),
})

function validate() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(
      `\n\n🚨 Missing or invalid environment variables:\n${lines}\n\n` +
      `Check .env.local (local dev) or Vercel → Settings → Environment Variables.\n`
    )
  }
  return result.data
}

export const env = validate()
