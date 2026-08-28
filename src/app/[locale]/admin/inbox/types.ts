/** Shapes shared by the three inbox panes (mirror the admin inbox API). */

export interface InboxContact {
  id: string
  name: string
  email: string | null
  phone_e164: string | null
  locale: string | null
  notes: string | null
}

export interface InboxListItem {
  id: string
  channel: 'webchat' | 'email' | 'whatsapp' | 'voice'
  status: 'open' | 'pending' | 'resolved'
  subject: string | null
  unread_count: number
  last_message_at: string
  /** WhatsApp only: when the free-form 24h reply window closes. Null for other channels. */
  wa_window_expires_at: string | null
  /** Set only for OTA notification emails (Withlocals, GetMyBoat, GetYourGuide) — null for real customer conversations. */
  ota_source: string | null
  /**
   * 'waiting' = new request, just an availability check. 'confirmed' = guest
   * already paid the platform, ready to create the booking. 'needs_import' =
   * a 3rd-party API already created the booking directly in FareHarbor —
   * ready to import into our own database instead. 'imported' = the human
   * clicked Import and it succeeded — settled, nothing left to do (set by
   * the import_fh_booking action, not handle-message.ts). 'sync_mismatch' =
   * our own website's FareHarbor booking notification has no matching row in
   * our own database — needs a manual check, not an import (see
   * handle-message.ts's 'own_channel' branch). A matching 'own_channel'
   * notification never reaches this state at all — it's auto-resolved
   * silently.
   */
  ota_status: 'waiting' | 'confirmed' | 'needs_import' | 'imported' | 'sync_mismatch' | null
  /** The actual guest's name, when the OTA's notification happens to expose it (GetMyBoat does; Withlocals doesn't). */
  ota_guest_name: string | null
  /** The AI's own live availability check, as a private cruise (Withlocals/GetMyBoat are always private) — null = not checked / not applicable (e.g. already confirmed). */
  ota_available: boolean | null
  /** One-line AI (Haiku) summary of the latest message — null falls back to the raw snippet. */
  ai_summary: string | null
  /** A supplier reply thread for a pending catering order (bookings.catering_thread_id) — not a customer conversation. */
  is_catering_thread: boolean
  /** When WE last sent a message in this conversation — null if we've never replied. */
  last_outbound_at: string | null
  /** The contact's soonest upcoming booking, or their most recent past one if none is upcoming. Null if they have no booking at all. */
  next_booking: { date: string; time: string | null } | null
  contact: Pick<InboxContact, 'id' | 'name' | 'email'> | null
  snippet: string
  snippet_direction: 'in' | 'out' | 'note' | null
}

export interface InboxMessage {
  id: string
  direction: 'in' | 'out' | 'note'
  body: string
  /** Email only, and only when the source had an HTML part — UNTRUSTED raw markup. Render only through SafeEmailHtml (which sanitizes), never directly. Null for chat/WhatsApp/voice/notes and for our own outbound replies. */
  body_html: string | null
  author_name: string | null
  status: string
  error: string | null
  created_at: string
  /** Voice calls only: the call/voicemail recording, if one was made. */
  recording_url: string | null
}

export interface InboxBooking {
  id: string
  booking_id: string
  booking_date: string | null
  start_time: string | null
  status: string | null
  guest_count: number | null
  listing_title: string | null
  receipt_total_display: string | null
}

/** A nearby option the Ghost validated when the asked slot wasn't bookable. */
export interface InboxAlternative {
  date: string
  time: string
  option: string
  boat_id: 'diana' | 'curacao'
  kind: 'same_day_earlier' | 'same_day_later' | 'other_boat' | 'other_day'
  listing_slug: string
  listing_title: string
  guests: number
  price_eur: number | null
  /** false = ranked-but-unvalidated estimate → show "est." */
  price_is_quote: boolean
}

/** What the guest actually asked for, as parsed from the OTA's own email (see ota/detect.ts). */
export interface OtaRequestedDetails {
  date: string | null
  time: string | null
  dateISO: string | null
  guests: number | null
  experienceName: string | null
}

/** A Ghost proposal surfaced for this conversation (reply draft, booking, or OTA fact block). */
export interface InboxGhostProposal {
  id: string
  kind: 'reply_draft' | 'booking_proposal' | 'booking_correction' | 'cancellation_request' | 'ota_availability' | 'ota_booking_ready' | 'fh_booking_import_ready'
  status: string
  reasoning: string | null
  created_at: string
  payload: {
    reply?: string
    /** English translation of the reply when it's not English/Dutch. */
    reply_en?: string | null
    language?: string
    booking?: {
      listing_slug?: string
      listing_title?: string
      date?: string
      time?: string
      guests?: number
      option?: string
      price_eur?: number
    }
    verdict?: { is_bookable: boolean; error: string | null; receipt_total_eur: number | null; alternatives?: InboxAlternative[] }
    correction?: {
      booking_id?: string
      field?: string
      new_value?: string
      booking_date?: string
      start_time?: string
      listing_title?: string
      guest_count?: number
    }
    cancellation?: {
      booking_id?: string
    }
    /** Policy-computed terms, stored right after the proposal is drafted — see
     *  src/lib/ghost/cancellation-terms.ts. Every number here is code output,
     *  never the model's; the card shows these, not anything Claude wrote. */
    cancellation_terms?: {
      bookingFound?: boolean
      guestName?: string | null
      listingTitle?: string | null
      departureAt?: string | null
      hoursUntilDeparture?: number | null
      refundPercent?: number
      amountPaidCents?: number
      refundCents?: number
      policySummary?: string
      bookingSource?: string | null
      isOtaBooking?: boolean
      alreadyCancelled?: boolean
      canCancelInFareharbor?: boolean
    }
    /** Names of the tools the agent actually called, in order — shown under the draft. */
    tools_used?: string[]
    // ota_availability / ota_booking_ready only:
    platform?: string
    booking_ref?: string | null
    guest_name?: string | null
    requested?: OtaRequestedDetails
    parsed?: OtaRequestedDetails
    checked?: boolean
    availability?: {
      available: boolean
      listings?: Array<{ category?: string; listing?: string; options?: Array<{ name: string; price_eur: number; duration_min: number }> }>
    }
  }
  outcome: {
    human_reply?: string
    comparison?: { verdict: 'match' | 'minor' | 'different'; summary: string }
  } | null
}

export interface InboxConversationDetail {
  conversation: {
    id: string
    channel: InboxListItem['channel']
    status: InboxListItem['status']
    subject: string | null
    unread_count: number
    last_message_at: string
    created_at: string
    booking_id: string | null
    /** WhatsApp only: when the free-form 24h reply window closes. Null for other channels. */
    wa_window_expires_at: string | null
    /** Same OTA fields as InboxListItem — the thread header reads these to show "Imported from X" once ota_status flips to 'imported'. */
    ota_source: string | null
    ota_status: InboxListItem['ota_status']
    ota_guest_name: string | null
    contact: InboxContact | null
  }
  messages: InboxMessage[]
  bookings: InboxBooking[]
  /** The Ghost's suggestions for this thread + the per-conversation learning trail. */
  ghost: {
    replyDraft: InboxGhostProposal | null
    bookingProposal: InboxGhostProposal | null
    bookingCorrection: InboxGhostProposal | null
    cancellationRequest: InboxGhostProposal | null
    /** New OTA booking request — read-only availability check, no reply to send. */
    otaAvailability: InboxGhostProposal | null
    /** OTA booking confirmed by the guest on the platform — review and create it manually. */
    otaBookingReady: InboxGhostProposal | null
    /** A 3rd-party API already created this booking directly in FareHarbor — review and import it into our database. */
    fhImportReady: InboxGhostProposal | null
    history: InboxGhostProposal[]
  }
}

/**
 * True when the Ghost co-pilot has ANY of the 7 proposal kinds pending —
 * shared by ContextPane.tsx (whether to render the co-pilot card at all) and
 * page.tsx (the mobile drawer's "there's something to act on" dot badge).
 * Was two independently hand-maintained lists that had already drifted:
 * page.tsx's copy was missing cancellationRequest and fhImportReady, so a
 * pending cancellation/refund or an import-ready booking never lit up the
 * mobile badge (found during a 2026-08-23 simplify pass). Add new kinds to
 * InboxConversationDetail['ghost'] and they're automatically covered here —
 * nothing to remember to update in a second place.
 */
export function hasGhostCoPilotContent(ghost: InboxConversationDetail['ghost'] | undefined): boolean {
  if (!ghost) return false
  return !!(
    ghost.replyDraft ||
    ghost.bookingProposal ||
    ghost.bookingCorrection ||
    ghost.cancellationRequest ||
    ghost.otaAvailability ||
    ghost.otaBookingReady ||
    ghost.fhImportReady
  )
}
