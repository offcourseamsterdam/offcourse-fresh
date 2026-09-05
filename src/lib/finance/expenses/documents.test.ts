import { describe, it, expect } from 'vitest'
import { isCandidateAttachmentMime, sha256Hex, sniffDocumentType } from './documents'

const pad = (head: number[] | string, len = 16) => {
  const h = typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head)
  return Buffer.concat([h, Buffer.alloc(Math.max(0, len - h.length))])
}

describe('sniffDocumentType', () => {
  it('PDF', () => expect(sniffDocumentType(pad('%PDF-1.7\n'))?.ext).toBe('pdf'))
  it('JPEG', () => expect(sniffDocumentType(pad([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe('image/jpeg'))
  it('PNG', () => expect(sniffDocumentType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe('png'))
  it('WEBP', () => expect(sniffDocumentType(pad('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp'))
  it('HEIC (iPhone receipt photo)', () => expect(sniffDocumentType(pad('\0\0\0\x18ftypheic\0\0\0\0'))?.ext).toBe('heic'))

  it('refuses anything else, however it is named or labelled', () => {
    expect(sniffDocumentType(Buffer.from('<html><body>invoice</body></html>'))).toBeNull()
    expect(sniffDocumentType(Buffer.from('MZ\x90\0'))).toBeNull() // an .exe pretending to be a receipt
    expect(sniffDocumentType(Buffer.alloc(0))).toBeNull()
    expect(sniffDocumentType(Buffer.from('%PDF'))).toBeNull() // too short to be sure
  })
})

describe('sha256Hex', () => {
  it('is stable and content-based', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex(Buffer.from('abc')))
    expect(sha256Hex(Buffer.from('abd'))).not.toBe(sha256Hex(Buffer.from('abc')))
  })
})

describe('isCandidateAttachmentMime', () => {
  it('PDFs and images are candidates; spreadsheets, calendars, signatures are not', () => {
    expect(isCandidateAttachmentMime('application/pdf')).toBe(true)
    expect(isCandidateAttachmentMime('image/jpeg')).toBe(true)
    expect(isCandidateAttachmentMime('IMAGE/HEIC')).toBe(true)
    expect(isCandidateAttachmentMime('application/vnd.ms-excel')).toBe(false)
    expect(isCandidateAttachmentMime('text/calendar')).toBe(false)
  })
})
