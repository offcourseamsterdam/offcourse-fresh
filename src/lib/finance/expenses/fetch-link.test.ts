import { describe, it, expect, vi } from 'vitest'
import { fetchPublicPdf, isForbiddenUrl, isPrivateAddress } from './fetch-link'

const PDF = Buffer.concat([Buffer.from('%PDF-1.7 hello'), Buffer.alloc(16)])

function response(opts: { status?: number; body?: Buffer; headers?: Record<string, string> } = {}): Response {
  const body = opts.body ?? Buffer.alloc(0)
  const headers = new Headers(opts.headers ?? {})
  return {
    status: opts.status ?? 200,
    ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
    headers,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response
}

const publicDns = async () => ['93.184.216.34']

describe('isPrivateAddress', () => {
  it.each(['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])('blocks %s', ip => {
    expect(isPrivateAddress(ip)).toBe(true)
  })
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])('allows %s', ip => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('isPrivateAddress — every spelling of an internal address', () => {
  it.each([
    '::ffff:7f00:1',        // 127.0.0.1 mapped, hex form (what WHATWG URL produces for [::ffff:127.0.0.1])
    '::ffff:a9fe:a9fe',     // 169.254.169.254 mapped, hex form (cloud metadata)
    '::ffff:a00:1',         // 10.0.0.1 mapped
    '0:0:0:0:0:ffff:7f00:1',
    '64:ff9b::7f00:1',      // NAT64 → 127.0.0.1
    '2002:7f00:100::',      // 6to4 → 127.0.1.0
    '::',                   // unspecified
    '::7f00:1',             // deprecated IPv4-compatible → 127.0.0.1
    'fec0::1',              // site-local
    'ff02::1',              // multicast
    '224.0.0.1', '255.255.255.255', '192.0.0.1', '198.18.0.1', '0.1.2.3',
    'not-an-ip',
  ])('blocks %s', ip => {
    expect(isPrivateAddress(ip)).toBe(true)
  })
  it.each(['::ffff:5db8:d822', '64:ff9b::5db8:d822', '2a00:1450:4001:80b::200e', '2002:5db8:d822::'])('allows public %s', ip => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('isForbiddenUrl', () => {
  it('refuses every IP-literal host outright — a public invoice link has a hostname', () => {
    for (const u of ['http://[::ffff:127.0.0.1]/x.pdf', 'http://[::ffff:7f00:1]/x.pdf', 'http://93.184.216.34/x.pdf', 'http://0x7f000001/x.pdf', 'http://2130706433/x.pdf', 'http://[2a00:1450::1]/x.pdf', 'https://user:pw@www.example.com/x.pdf']) {
      expect(isForbiddenUrl(new URL(u))).toBe(true)
    }
  })
  it('blocks non-http schemes, internal hostnames and private IP literals', () => {
    expect(isForbiddenUrl(new URL('file:///etc/passwd'))).toBe(true)
    expect(isForbiddenUrl(new URL('ftp://example.com/x'))).toBe(true)
    expect(isForbiddenUrl(new URL('http://localhost:3000/x'))).toBe(true)
    expect(isForbiddenUrl(new URL('http://db.internal/x'))).toBe(true)
    expect(isForbiddenUrl(new URL('http://10.0.0.5/x'))).toBe(true)
    expect(isForbiddenUrl(new URL('http://[::1]/x'))).toBe(true)
  })
  it('allows an ordinary public https URL', () => {
    expect(isForbiddenUrl(new URL('https://www.bol.com/invoices/x.pdf'))).toBe(false)
  })
})

describe('fetchPublicPdf', () => {
  it('fetches a public PDF with no credentials and manual redirects', async () => {
    const f = vi.fn().mockResolvedValue(response({ body: PDF, headers: { 'content-length': String(PDF.length) } }))
    const r = await fetchPublicPdf('https://www.bol.com/invoices/INV-1.pdf', { fetchImpl: f, resolveHost: publicDns })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bytes.equals(PDF)).toBe(true)
    const init = f.mock.calls[0][1]
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
  })

  it('a hostname resolving to a private address is refused before any request', async () => {
    const f = vi.fn()
    const r = await fetchPublicPdf('https://invoices.example.com/x.pdf', { fetchImpl: f, resolveHost: async () => ['10.0.0.5'] })
    expect(r).toEqual({ ok: false, reason: 'forbidden' })
    expect(f).not.toHaveBeenCalled()
  })

  it('a host with one public and one private address is refused (DNS rebinding tricks)', async () => {
    const r = await fetchPublicPdf('https://x.example.com/a.pdf', { fetchImpl: vi.fn(), resolveHost: async () => ['93.184.216.34', '192.168.0.1'] })
    expect(r).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('follows a redirect to another public host, re-checking it', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(response({ status: 302, headers: { location: 'https://cdn.example.com/x.pdf' } }))
      .mockResolvedValueOnce(response({ body: PDF }))
    const r = await fetchPublicPdf('https://www.example.com/download', { fetchImpl: f, resolveHost: publicDns })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.finalUrl).toBe('https://cdn.example.com/x.pdf')
  })

  it('a redirect into private space is refused', async () => {
    const f = vi.fn().mockResolvedValueOnce(response({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))
    const r = await fetchPublicPdf('https://www.example.com/download', { fetchImpl: f, resolveHost: publicDns })
    expect(r).toEqual({ ok: false, reason: 'forbidden' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('gives up after too many redirects', async () => {
    const f = vi.fn().mockResolvedValue(response({ status: 301, headers: { location: 'https://www.example.com/again' } }))
    const r = await fetchPublicPdf('https://www.example.com/a', { fetchImpl: f, resolveHost: publicDns })
    expect(r).toEqual({ ok: false, reason: 'too_many_redirects' })
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('an HTML login page is not_pdf — it is surfaced for manual download, never scraped', async () => {
    const f = vi.fn().mockResolvedValue(response({ body: Buffer.from('<!doctype html><title>Log in</title>'), headers: { 'content-type': 'application/pdf' } }))
    expect(await fetchPublicPdf('https://portal.example.com/invoice', { fetchImpl: f, resolveHost: publicDns })).toEqual({ ok: false, reason: 'not_pdf' })
  })

  it('refuses oversized documents by declared and by real size', async () => {
    const f1 = vi.fn().mockResolvedValue(response({ body: PDF, headers: { 'content-length': String(20 * 1024 * 1024) } }))
    expect(await fetchPublicPdf('https://www.example.com/big.pdf', { fetchImpl: f1, resolveHost: publicDns })).toEqual({ ok: false, reason: 'too_large' })
    const big = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(15 * 1024 * 1024 + 1)])
    const f2 = vi.fn().mockResolvedValue(response({ body: big }))
    expect(await fetchPublicPdf('https://www.example.com/big2.pdf', { fetchImpl: f2, resolveHost: publicDns })).toEqual({ ok: false, reason: 'too_large' })
  })

  it('DNS that fails or answers nothing is forbidden; a redirect without Location or with a broken one is a quiet failure', async () => {
    expect(await fetchPublicPdf('https://x.example.com/a.pdf', { fetchImpl: vi.fn(), resolveHost: async () => { throw new Error('ENOTFOUND') } })).toEqual({ ok: false, reason: 'forbidden' })
    expect(await fetchPublicPdf('https://x.example.com/a.pdf', { fetchImpl: vi.fn(), resolveHost: async () => [] })).toEqual({ ok: false, reason: 'forbidden' })
    expect(await fetchPublicPdf('https://www.example.com/x', { fetchImpl: vi.fn().mockResolvedValue(response({ status: 302 })), resolveHost: publicDns })).toEqual({ ok: false, reason: 'http_error' })
    expect(await fetchPublicPdf('https://www.example.com/x', { fetchImpl: vi.fn().mockResolvedValue(response({ status: 302, headers: { location: 'http://[' } })), resolveHost: publicDns })).toEqual({ ok: false, reason: 'invalid_url' })
  })

  it('a chunked body with no Content-Length is cut off the moment it passes 15 MB — never buffered whole', async () => {
    const chunk = new Uint8Array(1024 * 1024) // 1 MB
    let served = 0
    const stream = {
      getReader: () => ({
        read: async () => (served++ < 40 ? { done: false, value: chunk } : { done: true, value: undefined }),
      }),
    }
    const res = { ...response({ status: 200 }), body: stream } as unknown as Response
    const r = await fetchPublicPdf('https://www.example.com/drip.pdf', { fetchImpl: vi.fn().mockResolvedValue(res), resolveHost: publicDns })
    expect(r).toEqual({ ok: false, reason: 'too_large' })
    expect(served).toBeLessThanOrEqual(17) // stopped right after the cap, not after 40 MB
  })

  it('a body that stalls past the budget is a timeout — the timer covers the body, not just the headers', async () => {
    const stream = { getReader: () => ({ read: () => new Promise(() => undefined) }) } // never resolves
    const res = { ...response({ status: 200 }), body: stream } as unknown as Response
    const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      resolve(res)
    }))
    const r = await Promise.race([
      fetchPublicPdf('https://www.example.com/slow.pdf', { fetchImpl: f, resolveHost: publicDns, timeoutMs: 20 }),
      new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 2000)),
    ])
    // The reader never resolves, so the only way out is the abort → timeout; if the timer had been cleared at headers we'd hang.
    expect(r === 'hung' ? 'hung' : (r as { reason?: string }).reason).not.toBe('hung')
  })

  it('http errors, timeouts and invalid URLs are distinct, quiet failures', async () => {
    expect(await fetchPublicPdf('https://www.example.com/x', { fetchImpl: vi.fn().mockResolvedValue(response({ status: 404 })), resolveHost: publicDns })).toEqual({ ok: false, reason: 'http_error' })
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(await fetchPublicPdf('https://www.example.com/x', { fetchImpl: vi.fn().mockRejectedValue(abort), resolveHost: publicDns })).toEqual({ ok: false, reason: 'timeout' })
    expect(await fetchPublicPdf('not a url', { fetchImpl: vi.fn() })).toEqual({ ok: false, reason: 'invalid_url' })
  })
})
