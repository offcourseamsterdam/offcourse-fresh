#!/usr/bin/env -S npx tsx
/**
 * conversion-report.ts — Off Course weekly conversion insights.
 *
 * Reuses the SAME server-side analytics functions that power the admin tracking
 * dashboard (src/lib/tracking/queries.ts), so every number here matches what Beer
 * sees in /admin. Prints a clean Markdown report to stdout for several time
 * windows (default 7 / 30 / 90 days), each compared to the immediately preceding
 * period of equal length (so "last 7 days" is judged against "the 7 days before").
 *
 * Per window:
 *   • Headline KPIs — sessions, unique visitors, bookings, revenue, conversion rate (+ Δ vs prev period)
 *   • Entry funnel — all visitors → cruise page → checkout → booked (server-reliable, ad-blocker proof)
 *   • Channels      — sessions / bookings / revenue / conv-rate per acquisition channel
 *   • Top listings  — which cruises pull visitors and which actually convert
 *   • Devices       — mobile vs desktop booking-intent rate
 * Plus a Google Ads section (cost / clicks / conversions / cost-per-conv / ROAS per
 * campaign) for the 7- and 30-day windows, unless --no-ads.
 *
 * Usage (from repo root):
 *   npx tsx scripts/conversion-report.ts                 # 7 / 30 / 90-day report
 *   npx tsx scripts/conversion-report.ts --windows 7,30  # custom windows (days, comma-separated)
 *   npx tsx scripts/conversion-report.ts --no-ads        # skip the Google Ads section
 *
 * READ-ONLY. Reads Supabase (service role) + Google Ads (read GAQL). Never writes anything.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getOverviewKPIs,
  getEntryFunnel,
  getChannelMetrics,
  getConversionByListing,
  getDeviceMetrics,
  type DateRange,
} from '../src/lib/tracking/queries'

// ── Load .env.local (no dotenv dependency — mirrors scripts/google-ads/gads.ts) ──
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const withoutExport = trimmed.replace(/^export\s+/, '')
      const eq = withoutExport.indexOf('=')
      if (eq === -1) continue
      const key = withoutExport.slice(0, eq).trim()
      let val = withoutExport.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    console.error('⚠️  Could not read .env.local — relying on existing process env.')
  }
}
loadEnv()

// ── Tiny flag parser ──
const argv = process.argv.slice(2)
const noAds = argv.includes('--no-ads')
const windowsFlagIdx = argv.indexOf('--windows')
const windows =
  windowsFlagIdx !== -1 && argv[windowsFlagIdx + 1]
    ? argv[windowsFlagIdx + 1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0)
    : [7, 30, 90]

// ── Formatting helpers ──
const euro = (cents: number) =>
  '€' + Math.round(cents / 100).toLocaleString('en-IE')
const pct = (frac: number) => (frac * 100).toFixed(1) + '%'
const n = (x: number) => x.toLocaleString('en-IE')

/** Human delta vs previous period, e.g. "+18% ▲", "−7% ▼", "flat", "new". */
function delta(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? 'new ✦' : '—'
  const change = (cur - prev) / prev
  if (Math.abs(change) < 0.005) return 'flat'
  const arrow = change > 0 ? '▲' : '▼'
  const sign = change > 0 ? '+' : '−'
  return `${sign}${Math.abs(change * 100).toFixed(0)}% ${arrow}`
}

function windowRange(days: number, now: Date): DateRange {
  const to = now
  const from = new Date(now.getTime() - days * 86_400_000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Render an array of objects as a GitHub-flavoured Markdown table. */
function mdTable(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return '_(no data)_\n'
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map((c) => String(c)).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}\n`
}

async function windowSection(supabase: SupabaseClient, days: number, now: Date): Promise<string> {
  const range = windowRange(days, now)
  const [kpis, funnel, channels, listings, devices] = await Promise.all([
    getOverviewKPIs(supabase, range),
    getEntryFunnel(supabase, range),
    getChannelMetrics(supabase, range),
    getConversionByListing(supabase, range),
    getDeviceMetrics(supabase, range),
  ])

  const out: string[] = []
  out.push(`\n## Last ${days} days  _(vs previous ${days} days)_\n`)

  // Headline KPIs
  out.push(
    mdTable(
      ['Metric', 'Now', 'Prev', 'Δ'],
      [
        ['Sessions', n(kpis.sessions), n(kpis.prev_sessions), delta(kpis.sessions, kpis.prev_sessions)],
        ['Unique visitors', n(kpis.unique_visitors), '—', '—'],
        ['Bookings', n(kpis.bookings), n(kpis.prev_bookings), delta(kpis.bookings, kpis.prev_bookings)],
        ['Revenue', euro(kpis.revenue_cents), euro(kpis.prev_revenue_cents), delta(kpis.revenue_cents, kpis.prev_revenue_cents)],
        ['Conversion rate*', pct(kpis.conversion_rate), '—', '—'],
      ],
    ),
  )
  out.push(`\n_*Conversion rate = bookings ÷ unique visitors. ${n(kpis.anonymous_sessions)} sessions were from consent-less (anonymous) visitors and are excluded from the visitor count._\n`)

  // Entry funnel (server-reliable)
  out.push(`\n**Where visitors leak (entry funnel — server-side, ad-blocker proof):**\n`)
  out.push(
    mdTable(
      ['Stage', 'Visitors', '% of all', 'Drop from prev stage'],
      funnel.map((s) => [s.label, n(s.visitors), pct(s.pct_of_total), s.key === 'visitors' ? '—' : pct(s.drop_from_prev)]),
    ),
  )

  // Channels
  const activeChannels = channels.filter((c) => c.sessions > 0).sort((a, b) => b.sessions - a.sessions)
  out.push(`\n**Acquisition channels:**\n`)
  out.push(
    mdTable(
      ['Channel', 'Sessions', 'Bookings', 'Revenue', 'Conv %'],
      activeChannels.map((c) => [c.name, n(c.sessions), n(c.bookings), euro(c.revenue_cents), pct(c.conversion_rate)]),
    ),
  )

  // Top listings by visitors
  const topListings = listings.slice(0, 8)
  out.push(`\n**Top cruise listings (by direct-landing visitors):**\n`)
  out.push(
    mdTable(
      ['Listing', 'Type', 'Visitors', 'Bookings', 'Conv %'],
      topListings.map((l) => [l.title, l.category, n(l.visitors), n(l.bookings), pct(l.conversion_rate)]),
    ),
  )

  // Devices
  out.push(`\n**Devices (booking-intent rate = reached checkout ÷ reached a cruise page):**\n`)
  out.push(
    mdTable(
      ['Device', 'Visitors', 'Reached cruise', 'Reached checkout', 'Intent %'],
      devices.map((d) => [d.device, n(d.visitors), n(d.reached_cruise), n(d.reached_checkout), pct(d.checkout_rate)]),
    ),
  )

  return out.join('\n')
}

async function adsSection(): Promise<string> {
  const out: string[] = ['\n## Google Ads performance\n']
  try {
    const { campaignPerformance } = await import('../src/lib/google-ads/reporting')
    for (const days of [7, 30]) {
      const res = await campaignPerformance(days)
      out.push(`\n**Last ${days} days:**\n`)
      if (!res.ok) {
        out.push(`_Could not load: ${res.error}_\n`)
        continue
      }
      const rows = res.rows ?? []
      if (rows.length === 0) {
        out.push('_(no campaign activity)_\n')
        continue
      }
      // Totals row for the at-a-glance picture.
      const tCost = rows.reduce((s, r) => s + r.costEuros, 0)
      const tClicks = rows.reduce((s, r) => s + r.clicks, 0)
      const tConv = rows.reduce((s, r) => s + r.conversions, 0)
      const tValue = rows.reduce((s, r) => s + r.conversionValueEuros, 0)
      out.push(
        mdTable(
          ['Campaign', 'Cost', 'Clicks', 'Conv', 'Cost/Conv', 'ROAS'],
          [
            ...rows.map((r) => [
              r.name,
              '€' + r.costEuros.toFixed(0),
              n(r.clicks),
              r.conversions.toFixed(1),
              r.costPerConversionEuros == null ? '—' : '€' + r.costPerConversionEuros.toFixed(0),
              r.roas == null ? '—' : r.roas.toFixed(2) + '×',
            ]),
            [
              '**TOTAL**',
              '**€' + tCost.toFixed(0) + '**',
              '**' + n(tClicks) + '**',
              '**' + tConv.toFixed(1) + '**',
              tConv > 0 ? '**€' + (tCost / tConv).toFixed(0) + '**' : '—',
              tCost > 0 ? '**' + (tValue / tCost).toFixed(2) + '×**' : '—',
            ],
          ],
        ),
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    out.push(`_Google Ads section skipped — ${msg}_\n`)
  }
  return out.join('\n')
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (check .env.local).')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const now = new Date()
  const lines: string[] = []
  lines.push(`# Off Course — Conversion Insights`)
  lines.push(
    `_Generated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC · windows: ${windows.join(' / ')} days · revenue is gross (Stripe charged)._`,
  )

  for (const days of windows) {
    lines.push(await windowSection(supabase, days, now))
  }

  if (!noAds) {
    lines.push(await adsSection())
  }

  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error('✗ conversion-report failed:', err)
  process.exit(1)
})
