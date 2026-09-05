'use client'

import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { InboxShell } from '../../inbox/InboxShell'

/**
 * The Facturen desk (Beer, 2026-09-04: "as if the CFO has its own
 * environment") — the same three-pane inbox UI as /admin/inbox, but scoped to
 * only skipper/supplier invoice threads (source_category='finance'). A
 * customer message never lands here; an invoice never lands in the
 * operations inbox. See InboxShell's doc comment for how the split works.
 */
export default function FinanceInboxPage() {
  return (
    <div className="p-4 sm:p-8 h-[calc(100vh-0px)] flex flex-col gap-4">
      <FinanceSubnav />
      <div className="flex-1 min-h-0">
        <InboxShell scope="finance" title="Facturen" subtitle="Skipper- en leveranciersfacturen, op één plek." showUpload />
      </div>
    </div>
  )
}
