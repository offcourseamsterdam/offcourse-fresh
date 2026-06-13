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
  contact: Pick<InboxContact, 'id' | 'name' | 'email'> | null
  snippet: string
  snippet_direction: 'in' | 'out' | 'note' | null
}

export interface InboxMessage {
  id: string
  direction: 'in' | 'out' | 'note'
  body: string
  author_name: string | null
  status: string
  error: string | null
  created_at: string
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

/** A Ghost proposal surfaced for this conversation (reply draft or booking). */
export interface InboxGhostProposal {
  id: string
  kind: 'reply_draft' | 'booking_proposal'
  status: string
  reasoning: string | null
  created_at: string
  payload: {
    reply?: string
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
    verdict?: { is_bookable: boolean; error: string | null; receipt_total_eur: number | null }
  }
  outcome: { booking_id?: string; booked_by?: string } | null
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
    contact: InboxContact | null
  }
  messages: InboxMessage[]
  bookings: InboxBooking[]
  /** The Ghost's latest unactioned suggestions for this thread (P0 co-pilot). */
  ghost: { replyDraft: InboxGhostProposal | null; bookingProposal: InboxGhostProposal | null }
}
