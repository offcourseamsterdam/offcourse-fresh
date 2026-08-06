import { postSlackText, postSlackDM } from '@/lib/slack/send-notification'

/**
 * Failure alert for cron jobs (/api/cron/**, /api/fareharbor/sync).
 *
 * Crons run unattended — when one fails, nobody is watching the logs. This
 * sends the failure to Slack (the channel a human actually reads) in addition
 * to logging it. Never throws: alerting must not mask the original failure.
 *
 * Usage in a cron route:
 *   } catch (err) {
 *     await alertCronFailure('payment-reminders', err)
 *     return NextResponse.json({ error: 'Failed' }, { status: 500 })
 *   }
 *
 * `dmOnly` sends to Beer's Slack DM instead of the shared channel webhook —
 * no fallback to the channel either way, per Beer's explicit ask (2026-08-05)
 * to stop Gmail-sync failures from posting into the bookings channel. Opt in
 * per call site; every other cron keeps posting to the shared channel.
 */
export async function alertCronFailure(cronName: string, error: unknown, detail?: string, opts?: { dmOnly?: boolean }): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[cron/${cronName}] FAILED:`, error)
  const text =
    `:rotating_light: *Cron job failed: ${cronName}*\n` +
    `> ${message}` +
    (detail ? `\n> ${detail}` : '') +
    `\n_Check the Vercel function logs for the full stack trace._`

  if (opts?.dmOnly) {
    await postSlackDM(text)
  } else {
    await postSlackText(text)
  }
}
