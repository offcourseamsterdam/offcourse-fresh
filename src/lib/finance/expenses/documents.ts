/**
 * What a downloaded document actually IS, decided from its bytes — never from
 * a filename, a Content-Type header, or what Revolut/Gmail claims. The same
 * rule invoices/process.ts already applies to PDFs (isPdfBuffer), extended to
 * the image types a receipt photo arrives as. Plus the hash every document is
 * deduplicated on.
 *
 * Pure.
 */
import { createHash } from 'node:crypto'

export interface DocumentType {
  ext: 'pdf' | 'jpg' | 'png' | 'heic' | 'webp'
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp'
}

/** Same ceiling as the manual upload and the e-mail attachment path. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024

export function sniffDocumentType(buffer: Buffer): DocumentType | null {
  if (buffer.length < 12) return null
  const b = buffer
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mimeType: 'application/pdf' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mimeType: 'image/jpeg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { ext: 'png', mimeType: 'image/png' }
  }
  // RIFF....WEBP
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mimeType: 'image/webp' }
  }
  // ISO BMFF: ....ftypheic / ftypheix / ftypmif1 (iPhone receipt photos)
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1')
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return { ext: 'heic', mimeType: 'image/heic' }
  }
  return null
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Whether a MIME type Gmail reports is something we'd treat as a receipt/invoice candidate at all (the bytes still decide). */
export function isCandidateAttachmentMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase()
  return m === 'application/pdf' || m.startsWith('image/')
}
