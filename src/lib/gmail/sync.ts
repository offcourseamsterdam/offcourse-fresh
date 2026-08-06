// Gmail → inbox ingestion. Turns new inbox messages into contacts/conversations/
// messages rows (mirroring the webchat ingestion pattern in
// app/api/chat/start/route.ts) and hands each one to the existing, unmodified
// Ghost pipeline (draftShadowReply) — no channel-specific AI logic here.
import { createAdminClient } from '@/lib/supabase/admin'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'
import { detectCateringConfirmation } from '@/lib/catering/detect-confirmation'
import { detectOtaEmail, type OtaDetection } from '@/lib/ota/detect'
import { handleOtaMessage } from '@/lib/ota/handle-message'
import { summarizeInboundEmail } from './summarize'
import { emitOpsEvent } from '@/lib/ops/events'
import { alertCronFailure } from '@/lib/cron/alert'
import { findOrCreateContactByField } from '@/lib/contacts/find-or-create'
import { listNewMessages, getMessage, type GmailMessage } from './client'

/**
 * Every address a reply typed directly in Gmail (not through our admin
 * panel) might legitimately go out as. Confirmed live (2026-08-06) that
 * GMAIL_SUPPORT_ADDRESS (cruise@, an alias) and GMAIL_USER (info@, the
 * actual authenticated account) are DIFFERENT here — whether Gmail's own
 * "send mail as" picks the alias that matches the incoming address, or
 * falls back to the real account, isn't something this code controls or
 * can assume, so both count as "us" rather than guessing which one wins.
 */
function ourOwnAddresses(): Set<string> {
  return new Set(
    [process.env.GMAIL_SUPPORT_ADDRESS, process.env.GMAIL_USER]
      .filter((a): a is string => !!a)
      .map(a => a.toLowerCase()),
  )
}

/**
 * GMAIL_SUPPORT_ADDRESS scopes ingestion to mail actually addressed to the
 * support address — critical when that address is an ALIAS on a shared mailbox
 * (e.g. cruise@ delivering into info@'s inbox). Aliases don't get their own
 * mailbox; without this filter, every unrelated email in the real account's
 * inbox would be ingested into the AI pipeline, not just cruise@ traffic.
 * Falls back to GMAIL_USER (the authenticated account) when no alias is in play.
 */
function inboxQuery(): string {
  const supportAddress = process.env.GMAIL_SUPPORT_ADDRESS || process.env.GMAIL_USER
  // `to:` catches genuine inbound customer mail. `from:` ALSO catches a
  // reply typed directly in Gmail's own app/website — not through our admin
  // panel, which sends via the API and inserts its own 'out' row directly
  // (see api/admin/inbox/conversations/[id]/messages/route.ts). Gmail files
  // a message you send in Sent, addressed FROM you, which a `to:`-only
  // search never matches — see handleOutboundGmailMessage below for how
  // those get attached to their thread once they show up here. Every
  // address in ourOwnAddresses() is searched, not just the support alias —
  // see its own comment for why.
  // newer_than:1d bounds each poll to a rolling recent window — without it, a
  // busy long-lived address re-scans its ENTIRE history every single poll
  // forever (each message still deduped by provider_message_id, but at the
  // cost of one Gmail API call + a wasted lookup per message, every 2
  // minutes, growing without bound). 1 day is generous overlap for a 2-minute
  // cron; idempotency handles the rest. `in:inbox` is dropped in favor of
  // explicitly excluding spam/trash, since a sent reply never lives in the
  // inbox at all.
  const fromClauses = [...ourOwnAddresses()].map(a => `from:${a}`).join(' OR ')
  return `(to:${supportAddress} OR ${fromClauses}) -in:spam -in:trash -category:promotions newer_than:1d`
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Grouped strictly by Gmail's own threadId — NOT by "any open email conversation
 * for this contact" the way webchat groups by contact alone. A customer can have
 * two genuinely unrelated email threads open (a booking question and a separate
 * complaint); merging them into one conversation would be wrong. A resolved
 * thread that gets a new reply reopens rather than staying resolved.
 *
 * EXCEPT for an OTA notification with a booking reference (Withlocals, so far):
 * the platform sends separate, un-threaded Gmail messages for the same real
 * booking (a request, then later a confirmation) — matched instead by
 * (ota_source, ota_booking_ref) so they land in ONE conversation. See
 * docs/features/ota-notifications.md.
 */
async function lookupConversationByThreadId(
  supabase: SupabaseAdmin,
  threadId: string,
): Promise<{ id: string; unreadCount: number; status: string } | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, unread_count, status')
    .eq('channel', 'email')
    .eq('provider_thread_id', threadId)
    .maybeSingle()
  return data ? { id: data.id, unreadCount: data.unread_count ?? 0, status: data.status } : null
}

async function findOrCreateConversation(
  supabase: SupabaseAdmin,
  contactId: string,
  threadId: string,
  subject: string,
  ota: OtaDetection | null,
): Promise<{ id: string; unreadCount: number }> {
  if (ota?.bookingRef) {
    const { data: existingByRef } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('ota_source', ota.platform)
      .eq('ota_booking_ref', ota.bookingRef)
      .maybeSingle()
    if (existingByRef) return { id: existingByRef.id, unreadCount: existingByRef.unread_count ?? 0 }
  } else {
    const existing = await lookupConversationByThreadId(supabase, threadId)
    if (existing) return existing
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      channel: 'email',
      contact_id: contactId,
      provider_thread_id: threadId,
      subject: subject.length > 200 ? `${subject.slice(0, 197)}…` : subject,
      ota_source: ota?.platform ?? null,
      ota_booking_ref: ota?.bookingRef ?? null,
      ota_guest_name: ota?.guestName ?? null,
    })
    .select('id')
    .single()
  if (error) {
    // 23505 = another concurrent poll (a manual sync-gmail-now.ts run
    // overlapping the cron, or two overlapping cron invocations) already
    // inserted a conversation for this exact Gmail thread — backed by a
    // partial unique index on provider_thread_id (migration 118). Not a real
    // failure: fetch and use the row that won instead of erroring out.
    if (error.code === '23505') {
      const winner = await lookupConversationByThreadId(supabase, threadId)
      if (winner) return winner
    }
    throw new Error(`Could not create conversation for thread ${threadId}: ${error.message}`)
  }
  if (!created) throw new Error(`Could not create conversation for thread ${threadId}: no row returned`)
  return { id: created.id, unreadCount: 0 }
}

/**
 * A supplier reply to a still-pending catering order lands in the same Gmail
 * thread the order request was sent from (`bookings.catering_thread_id`, set
 * by `send-catering-email.ts`). That's a supplier/order-status message, not a
 * customer-service conversation — it must never get a Ghost-drafted "reply to
 * the customer", so this is checked and handled BEFORE draftShadowReply runs.
 *
 * Deliberately a plain classification call (see detect-confirmation.ts), not
 * a new Ghost kind/proposal — the "which booking" question is already
 * answered deterministically by the threadId match above, and confirming a
 * catering order is a low-stakes, reversible internal status flip, not a
 * money-moving or booking-creating action.
 *
 * Returns a short description of what happened when this message WAS a
 * pending-catering-order reply (handled here — caller must NOT also call
 * draftShadowReply for it, but should still feed this into the AI summary);
 * null otherwise, meaning the normal customer-conversation path should
 * proceed unaffected.
 */
async function handlePendingCateringReply(supabase: SupabaseAdmin, message: GmailMessage): Promise<string | null> {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_date')
    .eq('catering_thread_id', message.threadId)
    .is('catering_confirmed_at', null)
    .maybeSingle()

  if (!booking) return null

  const classification = await detectCateringConfirmation(message.bodyText)
  if (classification === 'confirmed') {
    await supabase
      .from('bookings')
      .update({ catering_confirmed_at: new Date().toISOString() })
      .eq('id', booking.id)

    await emitOpsEvent({
      eventType: 'catering_confirmed',
      actorType: 'agent',
      actorId: 'gmail_catering_confirmation',
      bookingId: booking.id,
      payload: { supplierEmail: message.from.email, bookingDate: booking.booking_date },
      source: 'gmail/sync',
    })
    return `Catering supplier confirmed the order for the ${booking.booking_date} cruise — marked confirmed automatically.`
  }
  // 'needs_reply' or 'unclear' — leave it as a normal, un-drafted conversation
  // in the inbox. A human sees an email thread with no Ghost draft and can
  // handle it manually. Intentionally the safe fallback, not a gap to fill.

  return classification === 'needs_reply'
    ? 'Catering supplier reply needs a human answer — no action taken.'
    : 'Catering supplier reply — unclear, needs review.'
}

/**
 * A reply sent directly from Gmail's own app/website — never through our
 * admin panel, which sends via the API and inserts its own 'out' row
 * directly (see api/admin/inbox/conversations/[id]/messages/route.ts).
 * Attaches to the SAME conversation the guest's original message is already
 * in, matched by Gmail's own thread id — the exact matching
 * findOrCreateConversation already relies on for ordinary inbound mail.
 * Never creates a new conversation, a contact for our own address, or a
 * Ghost draft: there's no customer message here to respond to.
 *
 * Returns 'no_conversation' rather than creating an orphan row when no
 * matching thread exists yet — this should only happen for a reply to a
 * thread that started before this poll's lookback window, an edge case not
 * worth guessing at.
 */
async function handleOutboundGmailMessage(
  supabase: SupabaseAdmin,
  message: GmailMessage,
): Promise<'inserted' | 'duplicate' | 'no_conversation'> {
  const conv = await lookupConversationByThreadId(supabase, message.threadId)
  if (!conv) return 'no_conversation'

  const { error: insertError } = await supabase.from('messages').insert({
    conversation_id: conv.id,
    direction: 'out',
    body: message.bodyText,
    body_html: message.bodyHtml,
    author_name: message.from.name,
    provider: 'gmail',
    provider_message_id: message.id,
    status: 'sent',
  })
  if (insertError) {
    // Same idempotency gate as the inbound path — a re-poll must not double-insert.
    if (insertError.code === '23505') return 'duplicate'
    throw new Error(`Could not save outbound Gmail message ${message.id}: ${insertError.message}`)
  }

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      // Replied → ball is in the customer's court, same convention the
      // admin-panel reply route uses. A thread already marked resolved
      // stays resolved — replying to a closed-out conversation shouldn't
      // silently reopen it.
      status: conv.status === 'resolved' ? 'resolved' : 'pending',
    })
    .eq('id', conv.id)

  return 'inserted'
}

export interface GmailSyncResult {
  imported: number
  skipped: number
}

export async function syncGmailInbox(): Promise<GmailSyncResult> {
  const supabase = createAdminClient()
  const refs = await listNewMessages(inboxQuery())
  const ourAddresses = ourOwnAddresses()

  let imported = 0
  let skipped = 0
  // Collected instead of alerted inline per-message: a shared-cause outage
  // (Supabase down, say) can fail every message in one poll, and alerting
  // per-failure would mean N sequential, awaited Slack POSTs for the same
  // root cause before the cron can even return. One summarized alert after
  // the loop costs one HTTP round-trip regardless of how many messages failed.
  const failures: { ref: string; error: unknown }[] = []

  for (const ref of refs) {
    let message: GmailMessage
    try {
      message = await getMessage(ref.id)
    } catch (err) {
      skipped++
      failures.push({ ref: ref.id, error: err })
      continue
    }

    // A reply sent directly from Gmail (not through our own admin panel) —
    // attach it to its thread and move on. Never a customer message, so
    // never routed through contact-matching, OTA detection, or Ghost.
    if (ourAddresses.has(message.from.email.toLowerCase())) {
      try {
        const outcome = await handleOutboundGmailMessage(supabase, message)
        if (outcome === 'inserted') imported++
        else skipped++
      } catch (err) {
        skipped++
        failures.push({ ref: ref.id, error: err })
      }
      continue
    }

    // Everything through "message saved" is wrapped: a throw anywhere in here
    // (a DB error creating its contact/conversation) must skip just THIS
    // message, never abort the rest of the poll. Without this, one bad
    // message would throw out of the loop entirely — and since it was never
    // inserted (no idempotency row), the NEXT poll fetches the exact same
    // message and throws again, permanently wedging the whole inbox sync
    // behind it.
    let ota: OtaDetection | null
    let conversationId: string
    let inserted: { id: string } | null
    try {
      ota = detectOtaEmail({ fromEmail: message.from.email, subject: message.subject, bodyText: message.bodyText })
      const contactId = await findOrCreateContactByField(supabase, 'email', message.from.email, message.from.name)
      const conv = await findOrCreateConversation(supabase, contactId, message.threadId, message.subject, ota)
      conversationId = conv.id

      const { data, error: insertError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          direction: 'in',
          body: message.bodyText,
          body_html: message.bodyHtml,
          author_name: message.from.name,
          provider: 'gmail',
          provider_message_id: message.id,
        })
        .select('id')
        .single()

      if (insertError) {
        // 23505 = we've already ingested this Gmail message id (a re-poll) — the
        // UNIQUE constraint on provider_message_id is the idempotency gate, same
        // pattern as the Stripe webhook's exactly-once insert.
        if (insertError.code === '23505') {
          skipped++
          continue
        }
        throw new Error(`Could not save Gmail message ${message.id}: ${insertError.message}`)
      }
      inserted = data

      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          unread_count: conv.unreadCount + 1,
          status: 'open',
        })
        .eq('id', conversationId)
    } catch (err) {
      skipped++
      failures.push({ ref: ref.id, error: err })
      continue
    }

    // The message itself is already saved at this point — a failure below
    // (e.g. checkOtaAvailability hitting a FareHarbor hiccup) must never abort
    // the rest of this poll's batch, the way draftShadowReply already
    // guarantees for the customer-reply path. Same "never break the flow"
    // rule, just applied to the two branches that don't have their own
    // built-in try/catch.
    let ghostContext: string | null = null
    try {
      const cateringContext = await handlePendingCateringReply(supabase, message)
      ghostContext = cateringContext
      if (!cateringContext) {
        if (ota) {
          // OTA notification: never a customer email reply (you act on the
          // platform, not by replying to info@withlocals.com) — a dedicated,
          // read-only fact block instead. See lib/ota/handle-message.ts.
          ghostContext = await handleOtaMessage(supabase, ota, conversationId, inserted?.id ?? null)
        } else {
          // Ghost drafts a reply/booking proposal — same pipeline webchat already
          // uses, unmodified. Awaited directly (this runs inside a cron, not a
          // request handler, so there's no after() to defer to).
          const shadowResult = await draftShadowReply(conversationId, inserted?.id ?? null)
          ghostContext = shadowResult
            ? `Ghost ${shadowResult.kind === 'reply_draft' ? 'drafted a reply' : shadowResult.kind === 'booking_proposal' ? 'proposed a booking' : 'proposed a contact-info correction'}: ${shadowResult.reasoning}`
            : null
        }
      }
    } catch (err) {
      console.error(`[gmail/sync] Ghost/OTA handling failed for message ${message.id}:`, err instanceof Error ? err.message : err)
    }

    // One-line AI summary for the inbox list — cheap, best-effort, never
    // blocks ingestion. Falls back to the raw body snippet if it fails.
    const summary = await summarizeInboundEmail({ subject: message.subject, bodyText: message.bodyText, context: ghostContext })
    if (summary) {
      await supabase.from('conversations').update({ ai_summary: summary }).eq('id', conversationId)
    }

    imported++
  }

  if (failures.length) {
    const failureList = failures
      .map(f => `${f.ref}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
      .join('\n')
    await alertCronFailure(
      'gmail-inbox-sync',
      failures[0].error,
      `${failures.length} message(s) skipped this poll — none were saved, so they'll be retried automatically next poll:\n${failureList}`,
      { dmOnly: true },
    )
  }

  return { imported, skipped }
}
