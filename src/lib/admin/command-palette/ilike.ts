/**
 * Make a user-typed search term safe to interpolate into a hand-built
 * PostgREST `.or('col.ilike.%term%,col2.ilike.%term%')` filter string.
 *
 * PostgREST treats `,` as the separator between OR-clauses and `(` `)` as
 * logical grouping in that string — a term containing them can inject extra
 * filter clauses. There's no escape syntax for a raw filter string, so this
 * strips them rather than escaping them.
 *
 * `%` and `_` are SQL LIKE wildcards; left in, a user's own `%`/`_` would
 * make their own query behave as a wildcard pattern instead of a literal
 * search — not a security issue on their own search, but confusing (a search
 * for "50%" quietly matching everything). Stripped for predictability.
 *
 * Existing routes (`cockpit/transactions`, `finance/expenses`) only strip
 * `%,` today and miss `()_` — this is the one place that logic should live;
 * point them at this too instead of leaving two narrower copies.
 */
export function escapeIlike(term: string): string {
  return term.replace(/[,()%_]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Wraps an already-escaped term in the `%…%` substring-match pattern.
 * Returns `null` when escaping strips the term down to nothing — a query of
 * only `,()%_` characters (e.g. ",," or "((") is non-empty going in, but an
 * empty pattern wrapped as `%%` matches every row, not zero rows. Every
 * caller must check for `null` and return no results rather than run a
 * filter built from it.
 */
export function ilikePattern(term: string): string | null {
  const escaped = escapeIlike(term)
  return escaped ? `%${escaped}%` : null
}
