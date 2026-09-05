/**
 * Two inboxes, one shared query filter. `operations` (the default,
 * /admin/inbox) is every customer/OTA/catering thread; `finance`
 * (/admin/finance/inbox) is only the skipper/supplier invoice threads at
 * GMAIL_FINANCE_ADDRESS. A thread is in exactly one of them — the CFO desk
 * never sees a guest asking about a birthday cruise, and the operations desk
 * never sees someone's invoice.
 *
 * A plain module, not exported from the conversations route itself: Next.js
 * App Router route files may only export the recognized HTTP-method/config
 * names (GET, POST, dynamic, ...) — any other export fails the generated
 * `.next/dev/types` route-shape check at build time.
 *
 * The operations filter is an `.or()`, not a bare `.neq('source_category',
 * 'finance')`: PostgREST's neq drops NULL rows (NULL != 'finance' is NULL,
 * not true in SQL), and source_category IS null for every ordinary thread —
 * a bare neq would have hidden the entire operations inbox. Literal filter
 * string, no user input in it.
 */
export type InboxScope = 'operations' | 'finance'

export function applyInboxScope<Q extends { or(f: string): Q; eq(c: string, v: string): Q }>(query: Q, scope: InboxScope): Q {
  return scope === 'finance' ? query.eq('source_category', 'finance') : query.or('source_category.is.null,source_category.neq.finance')
}
