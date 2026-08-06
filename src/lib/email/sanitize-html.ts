import DOMPurify from 'dompurify'

let hooksRegistered = false

/**
 * Two defenses beyond DOMPurify's own script/handler stripping, registered
 * once at module scope (not per-call — these hooks are global on the
 * DOMPurify instance, so adding/removing them per call would churn for no
 * reason and risks a race if two messages sanitize concurrently):
 *  - Remote <img> sources are dropped. Senders use a remote image as an
 *    invisible tracking pixel — the request itself tells them the moment
 *    the email was opened. Inline/embedded (data:) images make no network
 *    request and carry no such risk, so those are left alone.
 *  - Links are forced to a new tab with rel="noopener noreferrer", closing
 *    the "reverse tabnabbing" hole a bare target="_blank" leaves open.
 */
function ensureHooks() {
  if (hooksRegistered) return
  hooksRegistered = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'src' && node.tagName === 'IMG' && !data.attrValue.startsWith('data:')) {
      data.keepAttr = false
    }
  })
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

// <style> (the TAG) is forbidden — an email's own stylesheet could apply
// broad selectors that leak outside this one message bubble. Inline style=""
// ATTRIBUTES are deliberately still allowed (DOMPurify sanitizes their
// values) — that's how an email's own colors/formatting actually survive.
const FORBID_TAGS = ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base']

/**
 * Sanitizes an email's raw HTML (see gmail/client.ts's bodyHtml) for safe
 * display — see SafeEmailHtml.tsx for why this must only ever be called
 * client-side: DOMPurify has no Node/SSR fallback and throws without a real
 * browser `window`.
 */
export function sanitizeEmailHtml(html: string): string {
  ensureHooks()
  return DOMPurify.sanitize(html, { FORBID_TAGS })
}
