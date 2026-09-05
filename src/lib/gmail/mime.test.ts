import { describe, it, expect } from 'vitest'
import { buildMimeMessage } from './client'

const base = { from: 'finance@offcourseamsterdam.com', to: 'books@example.test', subject: 'Hello', body: 'Body text' }

describe('buildMimeMessage', () => {
  it('without attachments is the plain-text message we always sent', () => {
    const raw = buildMimeMessage(base)
    expect(raw).toBe(['To: books@example.test', 'From: finance@offcourseamsterdam.com', 'Subject: Hello', 'Content-Type: text/plain; charset="UTF-8"', '', 'Body text'].join('\r\n'))
  })

  it('encodes a non-ASCII subject (RFC 2047) and keeps In-Reply-To / References when replying', () => {
    const raw = buildMimeMessage({ ...base, subject: 'Factuur — augustus', inReplyTo: '<abc@mail>' })
    expect(raw).toContain('Subject: =?UTF-8?B?')
    expect(raw).toContain('In-Reply-To: <abc@mail>\r\nReferences: <abc@mail>')
  })

  it('with an attachment becomes multipart/mixed: text part first, then a base64 part with a safe filename', () => {
    const pdf = Buffer.from('%PDF-1.4 hello world, this is long enough to wrap the base64 output over more than one line of seventy-six characters')
    const raw = buildMimeMessage({ ...base, boundary: 'B1', attachments: [{ filename: 'FIN-000001 "bol" factuur\r\n.pdf', mimeType: 'application/pdf', content: pdf }] })
    expect(raw).toContain('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="B1"')
    expect(raw).toContain('--B1\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\nBody text')
    expect(raw).toContain('Content-Type: application/pdf; name="FIN-000001 bol factuur.pdf"')
    expect(raw).toContain('Content-Disposition: attachment; filename="FIN-000001 bol factuur.pdf"')
    expect(raw.trimEnd().endsWith('--B1--')).toBe(true)
    // Base64 body is wrapped at 76 columns and decodes back to the original bytes.
    const b64 = raw.split('Content-Disposition: attachment; filename="FIN-000001 bol factuur.pdf"\r\n\r\n')[1].split('\r\n--B1--')[0]
    expect(b64.split('\r\n').every(l => l.length <= 76)).toBe(true)
    expect(Buffer.from(b64.replace(/\r\n/g, ''), 'base64').equals(pdf)).toBe(true)
  })

  it('a caller-supplied mime type never reaches a header unless it is a plain type/subtype; two attachments → two parts, one closing boundary', () => {
    const raw = buildMimeMessage({ ...base, boundary: 'B2', attachments: [
      { filename: 'a.pdf', mimeType: 'application/pdf\r\nX-Injected: yes', content: Buffer.from('a') },
      { filename: '"\r\n', mimeType: 'image/jpeg', content: Buffer.from('b') },
    ] })
    expect(raw).not.toContain('X-Injected')
    expect(raw).toContain('Content-Type: application/octet-stream; name="a.pdf"')
    expect(raw).toContain('Content-Disposition: attachment; filename="attachment"')
    expect(raw.match(/Content-Disposition: attachment/g)).toHaveLength(2)
    expect(raw.match(/--B2--/g)).toHaveLength(1)
  })
})
