/**
 * Builds the homepage's HTTP Link header, per RFC 8288 (Web Linking) and
 * RFC 9727 Section 3. Lets an agent that only ever fetches "/" still find
 * everything else — the machine-readable API catalog, the OpenAPI spec, the
 * human docs, and the site's own prose description (llms.txt) — without
 * needing to already know those paths exist.
 */
export function buildHomepageLinkHeader(): string {
  return [
    '</.well-known/api-catalog>; rel="api-catalog"',
    '</openapi.yaml>; rel="service-desc"',
    '</api/v1/docs>; rel="service-doc"',
    '</llms.txt>; rel="describedby"',
  ].join(', ')
}
