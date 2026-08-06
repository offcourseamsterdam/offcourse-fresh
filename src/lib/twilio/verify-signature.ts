/**
 * Twilio inbound-webhook signature check — deliberately using the `twilio`
 * package's own `validateRequest` for this ONE function rather than
 * hand-rolling the HMAC-SHA1/param-sorting algorithm ourselves (the house
 * style elsewhere is raw fetch, no SDK). Twilio's own docs explicitly warn
 * against a manual implementation here: they add new webhook params without
 * notice, and query-string/URL-encoding edge cases are the #1 cause of
 * "signature invalid" bugs. Getting this wrong either lets forged requests
 * through or locks out every real one — not worth hand-rolling.
 */
import twilio from 'twilio'

/**
 * @param url The exact public URL Twilio was configured to POST to — must
 *   match byte-for-byte (scheme, host, path, query string) or the signature
 *   will never validate, even for a genuine Twilio request.
 * @param params The form-decoded POST body as a plain object.
 * @param signature The `X-Twilio-Signature` header value.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string,
): boolean {
  if (!signature || !authToken) return false
  return twilio.validateRequest(authToken, signature, url, params)
}
