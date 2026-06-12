import { postSlackText } from '@/lib/slack/send-notification'

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
 */
export async function alertCronFailure(cronName: string, error: unknown, detail?: string): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[cron/${cronName}] FAILED:`, error)
  await postSlackText(
    `:rotating_light: *Cron job failed: ${cronName}*\n` +
      `> ${message}` +
      (detail ? `\n> ${detail}` : '') +
      `\n_Check the Vercel function logs for the full stack trace._`,
  )
}
