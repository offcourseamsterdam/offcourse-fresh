'use client'

import { InboxShell } from './InboxShell'

/**
 * The operations inbox — every customer/OTA/catering thread, three panes on
 * desktop (list · thread · customer), drill-in on mobile (list → thread), per
 * docs/plans/unified-inbox-and-comms.md §8. Invoices have their own desk at
 * /admin/finance/inbox (see InboxShell's doc comment).
 */
export default function AdminInboxPage() {
  return (
    <div className="p-4 sm:p-6 h-[calc(100vh-0px)] flex flex-col">
      <InboxShell scope="operations" title="Inbox" subtitle="Every customer conversation, one place." />
    </div>
  )
}
