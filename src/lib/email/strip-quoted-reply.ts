/**
 * Removes the quoted-previous-message block that email clients embed in every
 * reply — Gmail's `.gmail_quote`, Yahoo's dynamically-hash-prefixed
 * `*yahoo_quoted` class, Outlook's `#divRplyFwdMsg` header plus everything
 * after it, and Apple Mail's `<blockquote type="cite">`. Without this, a
 * back-and-forth thread shows the same earlier message rendered twice: once
 * as its own message row, and again quoted inside the next reply's HTML.
 *
 * Must run client-side (DOMParser) — same constraint as sanitizeEmailHtml.
 * Run this AFTER sanitizing, never before: it trusts the DOM structure that
 * DOMPurify has already made safe.
 */
const QUOTE_ELEMENT_SELECTORS = ['.gmail_quote', '[class*="yahoo_quoted"]', 'blockquote[type="cite"]']

function removeOutlookQuote(doc: Document) {
  // Outlook's reply header ("From: ... Sent: ... To: ... Subject: ...") isn't
  // wrapped around the quoted body — it's a sibling followed by an <hr> and
  // then the quoted content. Remove the marker and everything after it.
  let node: Element | null = doc.querySelector('#divRplyFwdMsg')
  while (node) {
    const next: Element | null = node.nextElementSibling
    node.remove()
    node = next
  }
}

export function stripQuotedReply(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  QUOTE_ELEMENT_SELECTORS.forEach(selector => {
    doc.querySelectorAll(selector).forEach(el => el.remove())
  })
  removeOutlookQuote(doc)
  // If stripping left nothing (e.g. an unrecognized quote shape ate the real
  // content), show the original rather than an empty bubble.
  const stripped = doc.body.innerHTML.trim()
  return stripped || html
}
