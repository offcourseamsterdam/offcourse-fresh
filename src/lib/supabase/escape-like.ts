/**
 * Postgres's LIKE/ILIKE treats `%`, `_`, and `\` as pattern metacharacters
 * (backslash is the default escape character). Any value built into an
 * ilike() pattern from untrusted input — a customer-conversation extraction,
 * a raw header — must have these escaped first, or a value containing one
 * can widen the match far beyond what was intended (e.g. `%` alone matches
 * everything).
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
