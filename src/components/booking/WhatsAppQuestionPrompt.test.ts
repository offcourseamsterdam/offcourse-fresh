import { describe, it, expect } from 'vitest'
import { buildPrideWhatsAppMessage } from './WhatsAppQuestionPrompt'

describe('buildPrideWhatsAppMessage', () => {
  it('mentions the affiliate when a campaign slug is present', () => {
    const msg = buildPrideWhatsAppMessage('golden-tours')
    expect(msg).toContain('I found you through affiliate golden-tours.')
  })

  it('omits the affiliate line when there is no campaign slug', () => {
    const msg = buildPrideWhatsAppMessage(undefined)
    expect(msg).not.toContain('affiliate')
  })

  it('omits the affiliate line for a null campaign slug', () => {
    const msg = buildPrideWhatsAppMessage(null)
    expect(msg).not.toContain('affiliate')
  })

  it('always mentions the Pride Amsterdam cruise', () => {
    expect(buildPrideWhatsAppMessage()).toContain('Pride Amsterdam 2026 cruise')
    expect(buildPrideWhatsAppMessage('partner-x')).toContain('Pride Amsterdam 2026 cruise')
  })
})
