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
 *                    falls back to "Beer" when no captain is resolved
 *
 * The default template is stored here so it can be tested independently of
 * the database config. The admin can override it via google_reviews_config.
 */

export const DEFAULT_SMS_TEMPLATE =
  'Hi {firstName}! Thanks for sailing with us today on the {listingTitle} 🛥️\n\n' +
  'Here\'s our curated map of Amsterdam\'s favourite local food & drinks spots: {mapUrl}\n\n' +
  'If you had a great time, we\'d really appreciate a quick review on TripAdvisor: {reviewUrl}\n\n' +
  '— {captainName} & the Off Course team'

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
  /** First name of the captain assigned to the cruise; falls back to "Beer" when unresolved */
  captainName?: string | null
  /** Custom template from DB; falls back to DEFAULT_SMS_TEMPLATE when absent */
  template?: string | null
}

/**
 * Returns the rendered SMS body in English.
 * All tokens are replaced; missing listingTitle falls back to "the cruise",
 * missing captainName falls back to "Beer".
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
  const captain = (captainName && captainName.trim()) ? captainName.trim() : 'Beer'

  return tpl
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{listingTitle\}/g, title)
    .replace(/\{mapUrl\}/g, mapUrl)
    .replace(/\{reviewUrl\}/g, reviewUrl)
    .replace(/\{captainName\}/g, captain)
}
