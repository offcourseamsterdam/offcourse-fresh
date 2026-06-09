import { describe, it, expect } from 'vitest'
import { buildWhatsAppAdAlert } from './whatsapp-alert'

describe('buildWhatsAppAdAlert', () => {
  it('includes a headline and the friendly button label', () => {
    const msg = buildWhatsAppAdAlert({ source: 'floating_button' })
    expect(msg).toContain('Google Ads visitor just opened WhatsApp')
    expect(msg).toContain('Button: Floating button')
  })

  it('includes optional context lines only when present', () => {
    const full = buildWhatsAppAdAlert({
      source: 'chat_to_book',
      page: '/en/cruises/sunset',
      campaign: 'summer-sunset',
      country: 'NL',
      gclid: 'abc123',
    })
    expect(full).toContain('Button: Chat to book')
    expect(full).toContain('Page: /en/cruises/sunset')
    expect(full).toContain('Campaign: summer-sunset')
    expect(full).toContain('Country: NL')
    expect(full).toContain('gclid: abc123')
  })

  it('omits lines whose data is missing', () => {
    const msg = buildWhatsAppAdAlert({ source: 'footer' })
    expect(msg).not.toContain('Page:')
    expect(msg).not.toContain('Campaign:')
    expect(msg).not.toContain('Country:')
    expect(msg).not.toContain('gclid:')
  })

  it('falls back to the raw source when there is no friendly label', () => {
    expect(buildWhatsAppAdAlert({ source: 'mystery' })).toContain('Button: mystery')
  })

  it('handles a fully empty input without throwing', () => {
    expect(buildWhatsAppAdAlert({})).toContain('Button: unknown')
  })
})
