import { describe, it, expect } from 'vitest'
import { buildHomepageLinkHeader } from './link-header'

describe('buildHomepageLinkHeader', () => {
  it('includes all four registered relation types', () => {
    const header = buildHomepageLinkHeader()
    expect(header).toContain('rel="api-catalog"')
    expect(header).toContain('rel="service-desc"')
    expect(header).toContain('rel="service-doc"')
    expect(header).toContain('rel="describedby"')
  })

  it('points each relation at the correct target URL', () => {
    const header = buildHomepageLinkHeader()
    expect(header).toContain('</.well-known/api-catalog>')
    expect(header).toContain('</openapi.yaml>')
    expect(header).toContain('</api/v1/docs>')
    expect(header).toContain('</llms.txt>')
  })

  it('is a single comma-separated header value per RFC 8288', () => {
    const header = buildHomepageLinkHeader()
    expect(header.split(', ')).toHaveLength(4)
  })
})
