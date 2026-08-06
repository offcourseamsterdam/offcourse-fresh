/**
 * Manually run the Gmail inbox sync (same function the /api/cron/gmail-inbox-sync
 * route calls). Needed because that cron only actually runs once this branch is
 * deployed to Vercel — while developing locally on an undeployed branch, nothing
 * polls Gmail on its own, so this stands in for it.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json --import ./scripts/_preload-env.mjs scripts/sync-gmail-now.ts
 */
import { syncGmailInbox } from '@/lib/gmail/sync'

syncGmailInbox()
  .then(result => console.log('Gmail sync done:', result))
  .catch(err => {
    console.error('Gmail sync FAILED:', err)
    process.exit(1)
  })
