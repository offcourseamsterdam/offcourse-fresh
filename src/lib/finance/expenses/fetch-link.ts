/**
 * Fetching an invoice from a link in an e-mail — only when it's plainly a
 * public document (plan §3.2 step 3, decision 3). This code runs on a server
 * with access to our own infrastructure, so a URL from an untrusted mail is
 * treated as hostile input:
 *
 *  - http(s) only; never file:, ftp:, javascript:
 *  - IP-literal hosts are refused outright (a public invoice lives on a
 *    hostname); DNS answers are expanded and every address checked against the
 *    private/loopback/link-local/multicast/mapped ranges BEFORE connecting
 *    (SSRF guard); redirects are followed by hand, at most 3, re-checked each
 *    hop, so a public URL can't bounce us into the network
 *  - no cookies, no auth, 10 s total budget (headers AND body), 15 MB cap
 *    enforced while streaming — a lying Content-Length can't buffer more
 *  - the bytes must BE a PDF (magic bytes) — an HTML login page is 'not_pdf',
 *    surfaced as "download handmatig", never scraped further
 *
 * Residual risk, accepted and documented: the vetted addresses are not pinned
 * into the connection (Node's fetch does its own lookup), so a TTL-0 zone that
 * answers public-then-private (DNS rebinding) could still slip through. The
 * link filter (only document-looking links), the PDF sniff, the size/time caps
 * and the absence of credentials keep that to "one GET of ≤15 MB, no read-back
 * of non-PDF bytes".
 *
 * Both fetch and DNS are injectable so the guard itself is unit-tested.
 */
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { MAX_DOCUMENT_BYTES, sniffDocumentType } from './documents'

export const LINK_FETCH_TIMEOUT_MS = 10_000
export const LINK_MAX_REDIRECTS = 3

export type LinkFetchFailure = 'invalid_url' | 'forbidden' | 'too_many_redirects' | 'http_error' | 'too_large' | 'not_pdf' | 'timeout' | 'network'

export type LinkFetchResult = { ok: true; bytes: Buffer; finalUrl: string } | { ok: false; reason: LinkFetchFailure }

/** IPv4 ranges a server must never fetch from. [network, prefix]. */
const PRIVATE_V4: Array<[number, number]> = [
  [0x00000000, 8],  // 0.0.0.0/8 "this" network
  [0x0a000000, 8],  // 10/8
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8],  // 127/8 loopback
  [0xa9fe0000, 16], // 169.254/16 link-local (cloud metadata lives here)
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24 IETF protocol assignments
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xe0000000, 4],  // 224/4 multicast
  [0xf0000000, 4],  // 240/4 reserved + broadcast
]

function v4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isPrivateV4Int(n: number): boolean {
  return PRIVATE_V4.some(([net, bits]) => (n >>> (32 - bits)) === (net >>> (32 - bits)))
}

/** Expands any textual IPv6 (incl. `::`, embedded dotted quad) to 8 sixteen-bit groups; null when malformed. */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  // Embedded IPv4 tail (::ffff:1.2.3.4) → two hex groups.
  const dotted = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) {
    const v4 = v4ToInt(dotted[2])
    if (v4 == null) return null
    s = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const groups = part.split(':')
    const out: number[] = []
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  if (!head || !tail) return null
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  return [...head, ...new Array(missing).fill(0), ...tail]
}

/** IPv4/IPv6 addresses that must never be a fetch target from a server. Unparseable input counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = v4ToInt(ip)
  if (v4 != null) return isPrivateV4Int(v4)

  const g = expandIPv6(ip)
  if (!g) return true
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g
  const allZeroTo = (n: number) => g.slice(0, n).every(x => x === 0)

  // ::/128 unspecified, ::1 loopback, and the deprecated IPv4-compatible ::a.b.c.d (::/96)
  if (allZeroTo(6)) return true
  // ::ffff:a.b.c.d IPv4-mapped (any spelling — hex or dotted) → judge the v4
  if (allZeroTo(5) && g5 === 0xffff) return isPrivateV4Int(((g6 << 16) | g7) >>> 0)
  // 64:ff9b::/96 NAT64 → judge the embedded v4
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateV4Int(((g6 << 16) | g7) >>> 0)
  // 2002::/16 6to4 → judge the embedded v4 in groups 1–2
  if (g0 === 0x2002) return isPrivateV4Int(((g1 << 16) | g2) >>> 0)
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/** Cheap static checks before any network: scheme, obviously-internal hostnames, any IP literal (refused outright). */
export function isForbiddenUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
  if (url.username || url.password) return true
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.arpa')) return true
  // A public invoice link has a hostname. Any IP literal — dotted, hex, mapped, whatever — is refused.
  if (isIP(host) !== 0 || host.includes(':') || /^\d+(\.\d+)*$/.test(host) || /^0x/i.test(host)) return true
  return false
}

export interface LinkFetchDeps {
  fetchImpl?: typeof fetch
  /** Resolves a hostname to its addresses. Defaults to DNS. */
  resolveHost?: (hostname: string) => Promise<string[]>
  timeoutMs?: number
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true })
  return records.map(r => r.address)
}

async function hostIsPublic(url: URL, resolveHost: (h: string) => Promise<string[]>): Promise<boolean> {
  if (isForbiddenUrl(url)) return false
  let addresses: string[]
  try {
    addresses = await resolveHost(url.hostname)
  } catch {
    return false
  }
  if (addresses.length === 0) return false
  return addresses.every(a => !isPrivateAddress(a))
}

/**
 * Reads the body with a running byte count; aborts the connection the moment
 * the cap is passed. Every read is raced against the abort signal, so a body
 * that stalls (slowloris) ends in 'timeout' when the budget runs out instead of
 * hanging the cron — a stream reader does not observe the signal by itself.
 */
async function readCapped(res: Response, cap: number, controller: AbortController): Promise<Buffer | 'too_large'> {
  const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
  if (controller.signal.aborted) throw abortError()
  const onAbort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(abortError()), { once: true }))

  if (!res.body) {
    const whole = Buffer.from(await Promise.race([res.arrayBuffer(), onAbort]))
    if (whole.length > cap) {
      controller.abort()
      return 'too_large'
    }
    return whole
  }

  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), onAbort])
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > cap) {
          controller.abort()
          reader.cancel?.()?.catch?.(() => undefined)
          return 'too_large'
        }
        // Copy the chunk: a producer may reuse its buffer between reads.
        chunks.push(Buffer.from(value))
      }
    }
  } finally {
    // Nothing more to read (or we bailed): let the connection go.
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, total)
}

export async function fetchPublicPdf(rawUrl: string, deps: LinkFetchDeps = {}): Promise<LinkFetchResult> {
  const f = deps.fetchImpl ?? fetch
  const resolveHost = deps.resolveHost ?? defaultResolve
  const timeoutMs = deps.timeoutMs ?? LINK_FETCH_TIMEOUT_MS

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  // One budget for the whole exchange, redirects and body included.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let hop = 0; hop <= LINK_MAX_REDIRECTS; hop++) {
      if (!(await hostIsPublic(url, resolveHost))) return { ok: false, reason: 'forbidden' }

      let res: Response
      try {
        res = await f(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'application/pdf,*/*;q=0.5', 'User-Agent': 'OffCourse-FinanceInbox/1.0 (+invoice fetch)' },
          cache: 'no-store',
          credentials: 'omit',
        })
      } catch (err) {
        return { ok: false, reason: controller.signal.aborted || (err as Error)?.name === 'AbortError' ? 'timeout' : 'network' }
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { ok: false, reason: 'http_error' }
        try {
          url = new URL(location, url)
        } catch {
          return { ok: false, reason: 'invalid_url' }
        }
        continue
      }
      if (!res.ok) return { ok: false, reason: 'http_error' }

      const declared = Number(res.headers.get('content-length') ?? '0')
      if (declared > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'too_large' }

      let bytes: Buffer | 'too_large'
      try {
        bytes = await readCapped(res, MAX_DOCUMENT_BYTES, controller)
      } catch (err) {
        return { ok: false, reason: controller.signal.aborted || (err as Error)?.name === 'AbortError' ? 'timeout' : 'network' }
      }
      if (bytes === 'too_large') return { ok: false, reason: 'too_large' }
      if (sniffDocumentType(bytes)?.ext !== 'pdf') return { ok: false, reason: 'not_pdf' }
      return { ok: true, bytes, finalUrl: url.toString() }
    }
    return { ok: false, reason: 'too_many_redirects' }
  } finally {
    clearTimeout(timer)
  }
}
