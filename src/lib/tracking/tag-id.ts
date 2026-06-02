/**
 * Sanitize a Google tag id read from an environment variable.
 *
 * Why this exists: env vars set in dashboards (e.g. Vercel) can pick up a trailing
 * newline or stray spaces. That id is interpolated into an inline gtag <script>
 * (`gtag('config', '<id>')`). A literal newline inside that single-quoted JS string
 * is illegal and throws "SyntaxError: Invalid or unexpected token" when the browser
 * parses the script — which surfaced as an `appendChild` error on the checkout page.
 *
 * Trimming the value defends against that no matter how messy the env var is.
 * Returns null for missing/blank values so the caller can render nothing.
 */
export function cleanTagId(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}
