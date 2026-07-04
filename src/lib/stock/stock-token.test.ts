import { describe, it, expect, beforeEach } from 'vitest'
import { generateStockToken, isValidStockToken, stockCountUrl } from './stock-token'

beforeEach(() => {
  process.env.STOCK_TOKEN_SECRET = 'test-secret'
})

describe('stock-token', () => {
  it('round-trips a valid token (32-char hex)', () => {
    const t = generateStockToken()
    expect(t).toHaveLength(32)
    expect(/^[0-9a-f]{32}$/.test(t)).toBe(true)
    expect(isValidStockToken(t)).toBe(true)
  })

  it('rejects a bad or empty token', () => {
    expect(isValidStockToken('nope')).toBe(false)
    expect(isValidStockToken('')).toBe(false)
  })

  it('builds the public URL with the token', () => {
    expect(stockCountUrl('https://x.com')).toBe(`https://x.com/en/stock/${generateStockToken()}`)
  })

  it('rotates: changing the secret invalidates the old token', () => {
    const a = generateStockToken()
    process.env.STOCK_TOKEN_SECRET = 'different-secret'
    expect(generateStockToken()).not.toBe(a)
    expect(isValidStockToken(a)).toBe(false)
  })
})
