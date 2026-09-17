import { createHash } from 'node:crypto'

/** Formats a skill artifact's digest per the Agent Skills Discovery RFC: `sha256:{64 lowercase hex chars}`. */
export function sha256Digest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
}
