import DOMPurify from 'dompurify'

let hooksRegistered = false

// Set immediately before each sanitize() call below and cleared right after
// — safe as a module-level flag (not a param threaded through DOMPurify's
// own API, which has none for this) because sanitize() is fully synchronous
// and JS is single-threaded, so no other call can interleave mid-execution.
let allowRemoteImagesForCurrentCall = false

/**
 * Two defenses beyond DOMPurify's own script/handler stripping, registered
 * once at module scope (not per-call — these hooks are global on the
 * DOMPurify instance, so adding/removing them per call would churn for no
 * reason and risks a race if two messages sanitize concurrently):
 *  - Remote <img> sources are dropped BY DEFAULT. Senders use a remote image
 *    as an invisible tracking pixel — the request itself tells them the
 *    moment the email was opened. Inline/embedded (data:) images make no
 *    network request and carry no such risk, so those are left alone.
 *    Callers who've already identified the sender as a trusted platform
 *    (see sanitizeEmailHtml's allowRemoteImages option) can opt out of this
 *    one defense for that specific message.
 *  - Links are forced to a new tab with rel="noopener noreferrer", closing
 *    the "reverse tabnabbing" hole a bare target="_blank" leaves open.
 */
function ensureHooks() {
  if (hooksRegistered) return
  hooksRegistered = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (
      data.attrName === 'src' &&
      node.tagName === 'IMG' &&
      !data.attrValue.startsWith('data:') &&
      !allowRemoteImagesForCurrentCall
    ) {
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
 *
 * `allowRemoteImages` opts a single call out of the tracking-pixel defense —
 * only pass true when the sender is already known/trusted (see
 * ThreadPane.tsx's use of lib/email/trusted-senders.ts), never for an
 * arbitrary/unverified sender.
 */
export function sanitizeEmailHtml(html: string, opts?: { allowRemoteImages?: boolean }): string {
  ensureHooks()
  allowRemoteImagesForCurrentCall = !!opts?.allowRemoteImages
  try {
    return DOMPurify.sanitize(html, { FORBID_TAGS })
  } finally {
    allowRemoteImagesForCurrentCall = false
  }
}
