// GET /api/v1/docs
// Human-readable documentation for the public read-only API — the
// `service-doc` link relation in /.well-known/api-catalog (RFC 9727).
// Lives under /api/v1 (not the [locale] tree) so it's a stable, locale-free
// URL and bypasses proxy.ts's locale redirect entirely, same as every other
// /api/* route.
const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Off Course Amsterdam — Public API</title>
<style>
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem 4rem; color: #1a1a2e; }
  h1 { margin-bottom: 0.25rem; }
  p.lead { color: #555; margin-top: 0; }
  h2 { margin-top: 2.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.4rem; }
  code, pre { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  code { background: #f2f2f5; padding: 0.15em 0.4em; border-radius: 4px; }
  pre { background: #1a1a2e; color: #f2f2f5; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { color: #555; font-weight: 600; }
  a { color: #4338ca; }
</style>
</head>
<body>
<h1>Off Course Amsterdam — Public API</h1>
<p class="lead">Read-only, unauthenticated JSON endpoints for cruise data and availability. No API key required — this is the same public data already shown on the website.</p>

<h2>Endpoints</h2>
<table>
  <tr><th>Method &amp; path</th><th>Description</th></tr>
  <tr><td><code>GET /api/v1/cruises</code></td><td>List every publicly bookable cruise (title, tagline, price, duration, capacity).</td></tr>
  <tr><td><code>GET /api/v1/cruises/{slug}</code></td><td>Full detail for one cruise: description, rates per boat/duration, highlights, FAQs.</td></tr>
  <tr><td><code>GET /api/search/slots</code></td><td>Live availability for one cruise on a given date and guest count.</td></tr>
  <tr><td><code>GET /api/v1/status</code></td><td>Health check for this API.</td></tr>
</table>

<h2>Machine-readable spec</h2>
<p>Full request/response schemas: <a href="/openapi.yaml">/openapi.yaml</a> (OpenAPI 3.0). Catalog entry point: <a href="/.well-known/api-catalog">/.well-known/api-catalog</a> (<a href="https://www.rfc-editor.org/rfc/rfc9727">RFC 9727</a>).</p>

<h2>Parameters</h2>
<p><code>locale</code> (optional, default <code>en</code>) — one of <code>en</code>, <code>nl</code>, <code>de</code>, <code>fr</code>, <code>es</code>, <code>pt</code>, <code>zh</code>. Accepted by every <code>/api/v1/cruises</code> endpoint.</p>

<h2>Example</h2>
<pre><code>curl https://offcourseamsterdam.com/api/v1/cruises/book-curacao-boat-tour-amsterdam?locale=en</code></pre>

<h2>Response shape</h2>
<p>Every response is <code>{ "ok": true, "data": { ... } }</code> on success, or <code>{ "ok": false, "error": "..." }</code> with a 4xx/5xx status on failure.</p>

<h2>Rate limits</h2>
<p>60 requests per minute per IP address on the <code>/api/v1</code> endpoints. Exceeding it returns <code>429</code>.</p>

<h2>Scope</h2>
<p>This API is read-only. Booking, payment, and account actions are not available via API and continue through <a href="/en/cruises">offcourseamsterdam.com</a> directly.</p>
</body>
</html>`

export function GET() {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
