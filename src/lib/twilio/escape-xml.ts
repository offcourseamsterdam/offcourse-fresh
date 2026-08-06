/**
 * Escapes a value before it's interpolated into hand-built TwiML. Twilio's
 * signature check only proves a request came from Twilio — it says nothing
 * about the VALUE of a param the browser SDK asked Twilio to forward (e.g.
 * the `To` number typed into the admin softphone's call button). Without
 * this, a value containing `</Number>` could break out of its tag and
 * inject extra TwiML directives.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
