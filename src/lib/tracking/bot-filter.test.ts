import { describe, it, expect } from 'vitest'
import { isBot } from './bot-filter'

describe('isBot', () => {
  it('detects Googlebot', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
  })

  it('detects Bingbot', () => {
    expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true)
  })

  it('detects Facebook preview crawler', () => {
    expect(isBot('facebookexternalhit/1.1')).toBe(true)
  })

  it('detects SEMrush bot', () => {
    expect(isBot('Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)')).toBe(true)
  })

  it('detects headless Chrome', () => {
    expect(isBot('Mozilla/5.0 HeadlessChrome/90.0')).toBe(true)
  })

  it('detects UptimeRobot', () => {
    expect(isBot('Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)')).toBe(true)
  })

  it('detects GPTBot', () => {
    expect(isBot('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0)')).toBe(true)
  })

  it('allows real Chrome browser', () => {
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false)
  })

  it('allows real Safari', () => {
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false)
  })

  it('allows real Firefox', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe(false)
  })

  it('handles null user agent', () => {
    expect(isBot(null)).toBe(false)
  })

  it('handles empty string', () => {
    expect(isBot('')).toBe(false)
  })
})
