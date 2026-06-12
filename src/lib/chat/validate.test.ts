import { describe, expect, it } from 'vitest'
import {
  isValidChatToken,
  MAX_MESSAGE_LENGTH,
  parseChatMessage,
  parseChatStart,
} from './validate'

describe('parseChatStart', () => {
  const valid = { name: 'Sarah', email: 'sarah@example.com', message: 'Hi there!' }

  it('accepts a valid payload and trims/lowercases', () => {
    const result = parseChatStart({
      name: '  Sarah ',
      email: ' Sarah@Example.COM ',
      message: '  Hi there! ',
    })
    expect(result).toEqual({
      payload: { name: 'Sarah', email: 'sarah@example.com', message: 'Hi there!' },
    })
  })

  it('rejects non-object bodies', () => {
    expect(parseChatStart(null)).toHaveProperty('error')
    expect(parseChatStart('hi')).toHaveProperty('error')
    expect(parseChatStart(undefined)).toHaveProperty('error')
  })

  it('rejects missing or empty name', () => {
    expect(parseChatStart({ ...valid, name: '' })).toHaveProperty('error')
    expect(parseChatStart({ ...valid, name: '   ' })).toHaveProperty('error')
    expect(parseChatStart({ ...valid, name: 42 })).toHaveProperty('error')
  })

  it('rejects a name over the length cap', () => {
    expect(parseChatStart({ ...valid, name: 'x'.repeat(81) })).toHaveProperty('error')
  })

  it('rejects invalid emails', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', 'a@b.c']) {
      expect(parseChatStart({ ...valid, email })).toHaveProperty('error')
    }
  })

  it('accepts normal emails', () => {
    expect(parseChatStart({ ...valid, email: 'beer+test@offcourse.amsterdam' })).toHaveProperty('payload')
  })
})

describe('parseChatMessage', () => {
  it('accepts and trims a normal message', () => {
    expect(parseChatMessage('  hello  ')).toEqual({ message: 'hello' })
  })

  it('rejects empty, whitespace-only, and non-string messages', () => {
    expect(parseChatMessage('')).toHaveProperty('error')
    expect(parseChatMessage('   ')).toHaveProperty('error')
    expect(parseChatMessage(null)).toHaveProperty('error')
    expect(parseChatMessage(123)).toHaveProperty('error')
  })

  it('enforces the length cap (after trim)', () => {
    expect(parseChatMessage('x'.repeat(MAX_MESSAGE_LENGTH))).toHaveProperty('message')
    expect(parseChatMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toHaveProperty('error')
  })
})

describe('isValidChatToken', () => {
  it('accepts UUIDs', () => {
    expect(isValidChatToken('edc9c60a-5f79-4105-8fe0-2a63a2d6b5bb')).toBe(true)
    expect(isValidChatToken('EDC9C60A-5F79-4105-8FE0-2A63A2D6B5BB')).toBe(true)
  })

  it('rejects everything else (SQL-ish, paths, empties)', () => {
    for (const bad of ['', 'abc', '../../etc/passwd', "1' OR '1'='1", null, undefined, 42]) {
      expect(isValidChatToken(bad)).toBe(false)
    }
  })
})
