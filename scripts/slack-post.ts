#!/usr/bin/env -S npx tsx
/**
 * slack-post.ts — post a message to the team Slack channel from the CLI.
 *
 * Reads SLACK_WEBHOOK_URL from .env.local (the same channel the app posts
 * booking notifications to). Unlike the app's fire-and-forget postSlackText(),
 * this CLI reports the HTTP status so callers (e.g. the weekly conversion-report
 * task) know whether delivery actually succeeded.
 *
 * Usage (from repo root):
 *   npx tsx scripts/slack-post.ts "your *mrkdwn* message"
 *   echo "your message" | npx tsx scripts/slack-post.ts        # read from stdin
 *
 * Slack mrkdwn cheatsheet: *bold*, _italic_, `code`, <https://url|label>, bullets with •.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
  const argText = process.argv.slice(2).join(' ').trim()
  // Fall back to stdin when no argument is given (allows piping a built-up message).
  const text = argText || (!process.stdin.isTTY ? readFileSync(0, 'utf8').trim() : '')

  if (!text) {
    console.error('usage: npx tsx scripts/slack-post.ts "<message>"   (or pipe text via stdin)')
    process.exit(1)
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    console.error('✗ SLACK_WEBHOOK_URL is not set (check .env.local). Nothing posted.')
    process.exit(1)
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (res.ok) {
    console.log(`✓ Posted to Slack (${text.length} chars, HTTP ${res.status}).`)
  } else {
    const body = await res.text().catch(() => '')
    console.error(`✗ Slack rejected the message (HTTP ${res.status}): ${body}`)
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('✗ slack-post failed:', err)
  process.exit(1)
})
