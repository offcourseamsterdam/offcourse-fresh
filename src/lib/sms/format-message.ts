/**
 * SMS message formatter for the post-cruise review request.
 *
 * Always produces English text regardless of the customer's locale.
 *
 * Supported template tokens (case-sensitive):
 *   {firstName}    — first word of customer_name; falls back to "there"
 *   {listingTitle} — the cruise name (e.g. "Sunset Cruise")
 *   {mapUrl}       — branded /r/map short link
 *   {reviewUrl}    — branded /r/review short link
 *   {captainName}  — first name of the captain assigned to the cruise;
 *                    falls back to "the crew" when no captain is resolved.
 *                    Available for custom templates that just want the name.
 *   {signOff}      — the full closing signature: "{captainName} & the Off
 *                    Course team" when a captain resolves, or plain
 *                    "The Off Course Team" when none does — never attributes
 *                    a cruise to a specific person it wasn't actually run by.
 *
 * The default template is stored here so it can be tested independently of
 * the database config. The admin can override it via google_reviews_config.
 *
 * Deliberately plain-ASCII (no emoji, no em-dash "—", only straight quotes):
 * a single non-GSM-7 character forces the WHOLE message into UCS-2 encoding,
 * which cuts the per-segment limit from ~153 to ~67 characters — roughly
 * doubling the number of (separately billed) SMS segments for the exact same
 * wording. Keep any future edits to this template GSM-7-safe for the same
 * reason; verified in format-message.test.ts.
 */

export const DEFAULT_SMS_TEMPLATE =
  'Hi {firstName}! Thanks for cruising with us on the {listingTitle}.\n\n' +
  'Our local food & drinks map: {mapUrl}\n\n' +
  'Had a great time? We\'d love a quick review on TripAdvisor: {reviewUrl}\n\n' +
  '- {signOff}'

export const DEFAULT_ENGLISH_SMS_TEMPLATE = DEFAULT_SMS_TEMPLATE

/**
 * Extracts the first name from a full name string.
 * "Beer Zoomers" → "Beer"
 * "Anna-Marie" → "Anna-Marie"
 * null / "" / whitespace-only → "there" (fallback)
 */
export function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return 'there'
  const trimmed = fullName.trim()
  if (!trimmed) return 'there'
  // Split on whitespace; take the first segment
  return trimmed.split(/\s+/)[0] ?? 'there'
}

export interface FormatSmsParams {
  customerName: string | null | undefined
  listingTitle: string | null | undefined
  mapUrl: string
  reviewUrl: string
  /** First name of the captain assigned to the cruise, if resolved */
  captainName?: string | null
  /** Custom template from DB; falls back to DEFAULT_SMS_TEMPLATE when absent */
  template?: string | null
}

/**
 * Returns the rendered SMS body in English.
 * All tokens are replaced; missing listingTitle falls back to "the cruise".
 * When no captain is resolved, {signOff} falls back to "The Off Course Team"
 * rather than naming anyone — never attribute a cruise to someone who didn't
 * actually run it.
 */
export function formatReviewSms({
  customerName,
  listingTitle,
  mapUrl,
  reviewUrl,
  captainName,
  template,
}: FormatSmsParams): string {
  const tpl = (template && template.trim()) ? template : DEFAULT_SMS_TEMPLATE
  const firstName = extractFirstName(customerName)
  const title = (listingTitle && listingTitle.trim()) ? listingTitle.trim() : 'the cruise'
  const captain = (captainName && captainName.trim()) ? captainName.trim() : null
  const signOff = captain ? `${captain} & the Off Course team` : 'The Off Course Team'

  return tpl
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{listingTitle\}/g, title)
    .replace(/\{mapUrl\}/g, mapUrl)
    .replace(/\{reviewUrl\}/g, reviewUrl)
    .replace(/\{captainName\}/g, captain ?? 'the crew')
    .replace(/\{signOff\}/g, signOff)
}
