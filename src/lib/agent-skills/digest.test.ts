import { describe, it, expect } from 'vitest'
import { sha256Digest } from './digest'

describe('sha256Digest', () => {
  it('matches the well-known SHA-256 of an empty string', () => {
    expect(sha256Digest('')).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  it('matches the well-known SHA-256 of "abc"', () => {
    expect(sha256Digest('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('is deterministic for the same content', () => {
    expect(sha256Digest('hello world')).toBe(sha256Digest('hello world'))
  })

  it('changes when content changes by even one character', () => {
    expect(sha256Digest('hello world')).not.toBe(sha256Digest('hello world!'))
  })
})
