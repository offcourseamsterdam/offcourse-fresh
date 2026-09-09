#!/usr/bin/env -S npx tsx
/**
 * slack-post.ts — post a message from the CLI to Beer's Slack DM.
 *
 * DM-ONLY BY DESIGN. This CLI is used by ops/reporting tasks (the weekly
 * conversion report, etc.), which per the "Slack Notification Routing" section
 * of CLAUDE.md must go to Beer's DM and NEVER to the shared #bookings channel.
 * Only catering orders and direct-booking notifications belong in #bookings,
 * and neither of those is ever sent from this script.
 *
 * It therefore reuses postSlackDM() (bot token + chat.postMessage) and does
 * NOT read SLACK_WEBHOOK_URL at all — there is deliberately no channel
 * fallback, mirroring postSlackOps(). If the DM cannot be delivered the
 * message is dropped with a non-zero exit rather than leaking to the channel.
 *
 * Unlike the app's fire-and-forget helpers, this CLI reports delivery status
 * so callers (e.g. the weekly conversion-report task) know whether the post
 * actually succeeded.
 *
 * Usage (from repo root):
 *   npx tsx scripts/slack-post.ts "your *mrkdwn* message"
 *   echo "your message" | npx tsx scripts/slack-post.ts        # read from stdin
 *
 * Destination: SLACK_ALERT_DM_CHANNEL (Beer's user ID), override with --to <id>.
 * Slack mrkdwn cheatsheet: *bold*, _italic_, `code`, <https://url|label>, bullets with •.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { postSlackDM } from '../src/lib/slack/send-notification'

// ── Load .env.local (mirrors scripts/google-ads/gads.ts) ──
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

async function run() {
  // Optional `--to <channel-or-user-id>` override, stripped before joining the message.
  const argv = process.argv.slice(2)
  let target: string | undefined
  const toIdx = argv.indexOf('--to')
  if (toIdx !== -1) {
    target = argv[toIdx + 1]
    argv.splice(toIdx, 2)
    if (!target) {
      console.error('✗ --to requires a Slack channel or user ID.')
      process.exit(1)
    }
  }

  const argText = argv.join(' ').trim()
  // Fall back to stdin when no argument is given (allows piping a built-up message).
  const text = argText || (!process.stdin.isTTY ? readFileSync(0, 'utf8').trim() : '')

  if (!text) {
    console.error('usage: npx tsx scripts/slack-post.ts [--to <id>] "<message>"   (or pipe text via stdin)')
    process.exit(1)
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    console.error(
      '✗ SLACK_BOT_TOKEN is not set (check .env.local). Nothing posted.\n' +
        '  This script posts to Beer\'s DM only and has no channel fallback by design.',
    )
    process.exit(1)
  }

  const destination = target || process.env.SLACK_ALERT_DM_CHANNEL || 'U08PRAX8A07'
  const sent = await postSlackDM(text, destination)

  if (sent) {
    console.log(`✓ Posted to Slack DM ${destination} (${text.length} chars).`)
  } else {
    // postSlackDM already logged the specific Slack error above.
    console.error(`✗ Slack DM to ${destination} failed — message dropped (no channel fallback by design).`)
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('✗ slack-post failed:', err)
  process.exit(1)
})
