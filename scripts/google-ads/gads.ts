#!/usr/bin/env -S npx tsx
/**
 * gads.ts — command-line control surface for the Google Ads campaign library.
 *
 * This is the "talking interface": Beer asks for something, Claude fills in the
 * command and runs it, then narrates Google's response. Every "create" defaults
 * to a DRY RUN (Google's validateOnly) — nothing real happens, nothing is spent —
 * until you pass --live.
 *
 * Usage (run from repo root):
 *   npx tsx scripts/google-ads/gads.ts <command> [flags]
 *
 * Commands:
 *   accounts                                 List accessible Google Ads accounts (auth check)
 *   campaigns                                List all campaigns + status + daily budget
 *   performance [--days 30]                  Per-campaign metrics (cost, conversions, ROAS)
 *   keywords [--campaign ID] [--days 30]     Keyword stats
 *   search-terms [--campaign ID] [--days 30] Real queries that triggered ads (find negatives)
 *   create [--config PATH] [--live]          Create a Search campaign (dry-run unless --live)
 *   pause --campaign ID                      Pause a campaign
 *   enable --campaign ID                     Enable a campaign
 *   budget --campaign ID --eur 30            Change daily budget
 *   add-keywords --adgroup ID [--match PHRASE] kw...   Add keywords to an ad group
 *   add-negatives --campaign ID neg...       Add campaign negative keywords
 *   research kw1 "kw2 kw3" ...              Keyword ideas + volume + CPC from Google's own data
 *     [--lang nl]   nl = Dutch (default: en = English)
 *     [--geo nl,uk,us]  comma-separated countries (default: nl,uk,us)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Database } from '../../src/lib/supabase/types'

// ── Load .env.local (no dotenv dependency) ──────────────────────────────────────
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

// ── Tiny flag parser ────────────────────────────────────────────────────────────
interface Args {
  _: string[]
  flags: Record<string, string | boolean>
}
function parseArgs(argv: string[]): Args {
  const _: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      _.push(a)
    }
  }
  return { _, flags }
}

const eur = (n: number | null | undefined) => (n == null ? '—' : `€${n.toFixed(2)}`)
const pct = (n: number) => `${n.toFixed(2)}%`

function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log('(no rows)')
    return
  }
  const cols = Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log(line(cols))
  console.log(line(widths.map(w => '─'.repeat(w))))
  for (const r of rows) console.log(line(cols.map(c => String(r[c] ?? ''))))
}

// ── Command handlers ────────────────────────────────────────────────────────────

async function cmdAccounts() {
  const { listAccessibleCustomers } = await import('../../src/lib/google-ads/reporting')
  const res = await listAccessibleCustomers()
  if (!res.ok) return fail(res.error)
  console.log('Accessible customer accounts (this is what your credentials can touch):')
  for (const id of res.rows ?? []) console.log('  •', id)
  console.log(`\nConfigured advertiser (GOOGLE_ADS_CUSTOMER_ID): ${process.env.GOOGLE_ADS_CUSTOMER_ID}`)
  console.log(`Manager / login-customer-id:                  ${process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}`)
}

async function cmdCampaigns() {
  const { listCampaigns } = await import('../../src/lib/google-ads/reporting')
  const res = await listCampaigns()
  if (!res.ok) return fail(res.error)
  table(
    (res.rows ?? []).map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      type: c.channelType,
      'daily budget': eur(c.dailyBudgetEuros),
    })),
  )
}

async function cmdPerformance(args: Args) {
  const days = Number(args.flags.days ?? 30)
  const { campaignPerformance } = await import('../../src/lib/google-ads/reporting')
  const res = await campaignPerformance(days)
  if (!res.ok) return fail(res.error)
  console.log(`Performance — last ${days} days:\n`)
  table(
    (res.rows ?? []).map(r => ({
      campaign: r.name,
      impr: r.impressions,
      clicks: r.clicks,
      ctr: pct(r.ctr),
      cost: eur(r.costEuros),
      conv: r.conversions.toFixed(1),
      'cost/conv': eur(r.costPerConversionEuros),
      'conv value': eur(r.conversionValueEuros),
      roas: r.roas == null ? '—' : `${r.roas.toFixed(2)}×`,
    })),
  )
}

async function cmdKeywords(args: Args) {
  const days = Number(args.flags.days ?? 30)
  const campaign = args.flags.campaign ? String(args.flags.campaign) : undefined
  const { listKeywords } = await import('../../src/lib/google-ads/reporting')
  const res = await listKeywords(campaign, days)
  if (!res.ok) return fail(res.error)
  table(
    (res.rows ?? []).map(k => ({
      keyword: k.text,
      match: k.matchType,
      status: k.status,
      'ad group': k.adGroup,
      impr: k.impressions,
      clicks: k.clicks,
      conv: k.conversions.toFixed(1),
      cost: eur(k.costEuros),
    })),
  )
}

async function cmdSearchTerms(args: Args) {
  const days = Number(args.flags.days ?? 30)
  const campaign = args.flags.campaign ? String(args.flags.campaign) : undefined
  const { searchTerms } = await import('../../src/lib/google-ads/reporting')
  const res = await searchTerms(campaign, days)
  if (!res.ok) return fail(res.error)
  console.log(`Search terms — last ${days} days (scan for irrelevant ones → add as negatives):\n`)
  table(
    (res.rows ?? []).map(t => ({
      'search term': t.term,
      impr: t.impressions,
      clicks: t.clicks,
      conv: t.conversions.toFixed(1),
      cost: eur(t.costEuros),
    })),
  )
}

// Lazily build a service-role Supabase client. The CLI runs outside Next, so we
// avoid the server-only admin wrapper and construct a plain typed client here.
async function supa() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient<Database>(url, key)
}

async function cmdCreate(args: Args) {
  const configPath = String(args.flags.config ?? 'scripts/google-ads/campaigns/private-cruise.json')
  const live = args.flags.live === true
  const spec = JSON.parse(readFileSync(resolve(process.cwd(), configPath), 'utf8'))

  const { createSearchCampaign } = await import('../../src/lib/google-ads/campaigns')

  // --listing <slug>: if the config didn't set a /t/ tracking URL, auto-fill the
  // landing URL from the listing slug. The DB link itself is to the MARKETING
  // campaign (derived from the /t/ slug below), not the listing directly.
  const listingSlug = args.flags.listing ? String(args.flags.listing) : undefined
  if (listingSlug) {
    const { listingUrl } = await import('../../src/lib/google-ads/listings')
    const sb = await supa()
    const { data: listing } = await sb.from('cruise_listings').select('id, title').eq('slug', listingSlug).single()
    if (!listing) return fail(`Listing not found for slug "${listingSlug}"`)
    if (!spec.ad.finalUrl || !spec.ad.finalUrl.includes('/t/')) {
      spec.ad.finalUrl = listingUrl(listingSlug)
      console.log(`Listing:     ${listing.title ?? listingSlug} (Final URL auto-set from slug)`)
    } else {
      console.log(`Listing:     ${listing.title ?? listingSlug} (keeping tracking URL ${spec.ad.finalUrl})`)
    }
  }

  // The campaign↔marketing-campaign link is derived from the ad's /t/<slug> Final URL.
  const marketingSlug = spec.ad.finalUrl?.match(/\/t\/([^/?#]+)/)?.[1]

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Campaign:    ${spec.campaignName}`)
  console.log(`Ad group:    ${spec.adGroupName}`)
  console.log(`Budget:      €${spec.dailyBudgetEuros}/day` + (spec.targetCpaEuros ? `  (Target CPA €${spec.targetCpaEuros})` : '  (Maximize Conversions)'))
  console.log(`Locations:   ${spec.locations.join(', ')}`)
  console.log(`Languages:   ${spec.languages.join(', ')}`)
  console.log(`Match type:  ${spec.matchType}`)
  console.log(`Keywords:    ${spec.keywords.length} phrase + ${(spec.exactKeywords ?? []).length} exact`)
  console.log(`Negatives:   ${(spec.negativeKeywords ?? []).length}`)
  console.log(`Headlines:   ${spec.ad.headlines.length}   Descriptions: ${spec.ad.descriptions.length}`)
  const ext = spec.extensions ?? {}
  console.log(`Extensions:  ${(ext.sitelinks ?? []).length} sitelinks · ${(ext.callouts ?? []).length} callouts · ${(ext.snippets ?? []).length} snippets`)
  console.log(`Final URL:   ${spec.ad.finalUrl}`)
  console.log(`Mode:        ${live ? '🔴 LIVE — will create the campaign (PAUSED)' : '🟢 DRY RUN (validateOnly) — nothing created'}`)
  console.log(`${'─'.repeat(60)}\n`)

  const res = await createSearchCampaign(spec, { validateOnly: !live })

  if (res.validationErrors?.length) {
    console.error('❌ Client-side validation failed (not sent to Google):')
    for (const e of res.validationErrors) console.error('   •', e)
    process.exitCode = 1
    return
  }
  if (!res.ok) {
    // Could be a Google API rejection or a local build error (e.g. unknown
    // country) — either way it was not created.
    console.error('❌ Rejected (not created):', res.error)
    process.exitCode = 1
    return
  }
  if (res.validateOnly) {
    console.log('✅ DRY RUN PASSED — Google validated the entire campaign. Nothing was created.')
    console.log('   Re-run with --live to create it (it will start PAUSED so you can review).')
  } else {
    console.log(`✅ CREATED — campaign id ${res.campaignId} (status: PAUSED).`)
    if (res.campaignId && marketingSlug) {
      const { setCampaignMarketingBySlug } = await import('../../src/lib/google-ads/listings')
      const { error } = await setCampaignMarketingBySlug(await supa(), res.campaignId, marketingSlug)
      if (error) console.log(`   ⚠️  Could not link marketing campaign "${marketingSlug}": ${error.message}`)
      else console.log(`   Linked to marketing campaign "${marketingSlug}" (listing derived from it).`)
    }
    console.log('   Review it in Google Ads, then: npx tsx scripts/google-ads/gads.ts enable --campaign ' + res.campaignId)
  }
}

async function cmdPauseEnable(args: Args, status: 'PAUSED' | 'ENABLED') {
  const campaign = String(args.flags.campaign ?? '')
  if (!campaign) return fail('--campaign ID is required')
  const { setCampaignStatus } = await import('../../src/lib/google-ads/campaigns')
  const res = await setCampaignStatus(campaign, status)
  if (!res.ok) return fail(res.error)
  console.log(`✅ Campaign ${campaign} → ${status}`)
}

async function cmdBudget(args: Args) {
  const campaign = String(args.flags.campaign ?? '')
  const eurAmt = Number(args.flags.eur)
  if (!campaign || !(eurAmt > 0)) return fail('need --campaign ID and --eur AMOUNT (>0)')
  const { updateCampaignBudget } = await import('../../src/lib/google-ads/campaigns')
  const res = await updateCampaignBudget(campaign, eurAmt)
  if (!res.ok) return fail(res.error)
  console.log(`✅ Campaign ${campaign} daily budget → €${eurAmt.toFixed(2)}`)
}

async function cmdAddKeywords(args: Args) {
  const adgroup = String(args.flags.adgroup ?? '')
  const match = String(args.flags.match ?? 'PHRASE').toUpperCase() as 'PHRASE' | 'EXACT' | 'BROAD'
  const keywords = args._
  if (!adgroup || keywords.length === 0) return fail('need --adgroup ID and at least one keyword')
  const { addKeywords } = await import('../../src/lib/google-ads/campaigns')
  const res = await addKeywords(adgroup, keywords, match)
  if (!res.ok) return fail(res.error)
  console.log(`✅ Added ${keywords.length} ${match} keyword(s) to ad group ${adgroup}`)
}

async function cmdAddNegatives(args: Args) {
  const campaign = String(args.flags.campaign ?? '')
  const negatives = args._
  if (!campaign || negatives.length === 0) return fail('need --campaign ID and at least one negative')
  const { addNegativeKeywords } = await import('../../src/lib/google-ads/campaigns')
  const res = await addNegativeKeywords(campaign, negatives)
  if (!res.ok) return fail(res.error)
  console.log(`✅ Added ${negatives.length} negative keyword(s) to campaign ${campaign}`)
}

const GEO_NAME_TO_ID: Record<string, number> = {
  nl: 2528, netherlands: 2528,
  uk: 2826, 'united kingdom': 2826, gb: 2826,
  us: 2840, usa: 2840, 'united states': 2840,
  de: 2276, germany: 2276,
  be: 2056, belgium: 2056,
  fr: 2250, france: 2250,
}

const LANG_NAME_TO_ID: Record<string, number> = {
  en: 1000, english: 1000,
  nl: 1010, dutch: 1010,
  de: 1001, german: 1001,
  fr: 1002, french: 1002,
}

const COMPETITION_ICON: Record<string, string> = {
  LOW: '🟢 Low',
  MEDIUM: '🟡 Med',
  HIGH: '🔴 High',
  UNSPECIFIED: '  — ',
}

async function cmdResearch(args: Args) {
  const seeds = args._.length > 0 ? args._ : [
    'private canal cruise amsterdam',
    'private boat tour amsterdam',
    'private boat amsterdam',
    'canal cruise amsterdam',
    'boat rental amsterdam',
  ]

  const langCode = String(args.flags.lang ?? 'en').toLowerCase()
  const langId = LANG_NAME_TO_ID[langCode] ?? 1000
  const langLabel = langId === 1010 ? 'Dutch' : 'English'

  const geoCodes = String(args.flags.geo ?? 'nl,uk,us').split(',').map(s => s.trim().toLowerCase())
  const geoIds = geoCodes.map(c => GEO_NAME_TO_ID[c]).filter((id): id is number => !!id)
  if (geoIds.length === 0) return fail(`Unknown geo codes: ${geoCodes.join(', ')}. Use: nl, uk, us, de, be, fr`)

  const { generateKeywordIdeas } = await import('../../src/lib/google-ads/keyword-research')

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`Keyword research — language: ${langLabel} | markets: ${geoCodes.join(', ')}`)
  console.log(`Seed keywords: ${seeds.join(', ')}`)
  console.log(`${'─'.repeat(70)}\n`)

  const res = await generateKeywordIdeas(seeds, langId, geoIds)
  if (!res.ok) return fail(res.error)

  const ideas = res.ideas ?? []
  if (ideas.length === 0) {
    console.log('No keyword ideas returned. Try different seed terms.')
    return
  }

  // Print table
  const col1 = Math.max(30, ...ideas.map(k => k.text.length))
  const header = `${'Keyword'.padEnd(col1)}  ${'Volume/mo'.padStart(10)}  ${'Comp'.padEnd(8)}  ${'Low bid'.padStart(8)}  ${'High bid'.padStart(9)}  ${'Avg CPC'.padStart(8)}`
  console.log(header)
  console.log('─'.repeat(header.length))

  for (const k of ideas) {
    const vol = k.avgMonthlySearches != null ? k.avgMonthlySearches.toLocaleString('en-US') : '—'
    const comp = COMPETITION_ICON[k.competition] ?? '—'
    const low = k.lowTopOfPageBidEuros != null ? `€${k.lowTopOfPageBidEuros.toFixed(2)}` : '—'
    const high = k.highTopOfPageBidEuros != null ? `€${k.highTopOfPageBidEuros.toFixed(2)}` : '—'
    const cpc = k.avgCpcEuros != null ? `€${k.avgCpcEuros.toFixed(2)}` : '—'
    console.log(`${k.text.padEnd(col1)}  ${vol.padStart(10)}  ${comp.padEnd(8)}  ${low.padStart(8)}  ${high.padStart(9)}  ${cpc.padStart(8)}`)
  }

  console.log(`\n${ideas.length} keyword ideas returned.`)
  console.log('Low bid = what it takes to show anywhere. High bid = top of page. Avg CPC = typical cost per click.')
}

function fail(msg?: string) {
  console.error('❌', msg ?? 'unknown error')
  process.exitCode = 1
}

// ── Dispatch ────────────────────────────────────────────────────────────────────
async function main() {
  const [, , command, ...rest] = process.argv
  const args = parseArgs(rest)
  switch (command) {
    case 'accounts': return cmdAccounts()
    case 'campaigns': return cmdCampaigns()
    case 'performance': return cmdPerformance(args)
    case 'keywords': return cmdKeywords(args)
    case 'search-terms': return cmdSearchTerms(args)
    case 'create': return cmdCreate(args)
    case 'pause': return cmdPauseEnable(args, 'PAUSED')
    case 'enable': return cmdPauseEnable(args, 'ENABLED')
    case 'budget': return cmdBudget(args)
    case 'add-keywords': return cmdAddKeywords(args)
    case 'add-negatives': return cmdAddNegatives(args)
    case 'research': return cmdResearch(args)
    default:
      console.log('Commands: accounts | campaigns | performance | keywords | search-terms |')
      console.log('          create | pause | enable | budget | add-keywords | add-negatives | research')
      console.log('\nSee the header of scripts/google-ads/gads.ts for flags.')
  }
}

main().catch(err => {
  console.error('💥 Unexpected error:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
