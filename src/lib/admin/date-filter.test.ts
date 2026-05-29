import { describe, it, expect } from 'vitest'
import { dateCreatedThreshold } from './date-filter'

// Reference point: Wednesday 7 May 2025, 10:00 UTC (= 12:00 Amsterdam CEST)
const REF = new Date('2025-05-07T10:00:00Z')

describe('dateCreatedThreshold', () => {
  it('returns null for "all"', () => {
    expect(dateCreatedThreshold('all', REF)).toBeNull()
  })

  it('"today" returns start of 7 May 2025 Amsterdam time', () => {
    const result = dateCreatedThreshold('today', REF)!
    // Amsterdam is UTC+2 (CEST) on 7 May → midnight = 2025-05-06T22:00:00Z
    expect(result).not.toBeNull()
    // Booking from that morning should pass
    expect(new Date('2025-05-07T08:00:00Z') >= result).toBe(true)
    // Booking from the previous day should not
    expect(new Date('2025-05-06T21:00:00Z') >= result).toBe(false)
  })

  it('"week" returns start of ISO week (Monday 5 May 2025)', () => {
    const result = dateCreatedThreshold('week', REF)!
    expect(result).not.toBeNull()
    // Monday 5 May 00:00 Amsterdam = 2025-05-04T22:00:00Z
    expect(new Date('2025-05-04T23:00:00Z') >= result).toBe(true)  // Mon 5 May 01:00 AMS
    expect(new Date('2025-05-04T21:00:00Z') >= result).toBe(false) // Sun 4 May 23:00 AMS
  })

  it('"week" on Sunday steps back 6 days to Monday', () => {
    // Sunday 11 May 2025, 10:00 UTC (= 12:00 AMS)
    const sunday = new Date('2025-05-11T10:00:00Z')
    const result = dateCreatedThreshold('week', sunday)!
    // Should still give Monday 5 May 00:00 AMS
    expect(new Date('2025-05-04T23:00:00Z') >= result).toBe(true)
    expect(new Date('2025-05-04T21:00:00Z') >= result).toBe(false)
  })

  it('"month" returns start of May 2025', () => {
    const result = dateCreatedThreshold('month', REF)!
    expect(result).not.toBeNull()
    // 1 May 00:00 AMS = 2025-04-30T22:00:00Z
    expect(new Date('2025-04-30T23:00:00Z') >= result).toBe(true)  // 1 May 01:00 AMS
    expect(new Date('2025-04-30T21:00:00Z') >= result).toBe(false) // 30 Apr 23:00 AMS
  })

  it('"quarter" returns start of Q2 2025 (1 April)', () => {
    const result = dateCreatedThreshold('quarter', REF)!
    expect(result).not.toBeNull()
    // 1 Apr 00:00 AMS = 2025-03-31T22:00:00Z (CEST starts 30 Mar)
    expect(new Date('2025-03-31T23:00:00Z') >= result).toBe(true)  // 1 Apr 01:00 AMS
    expect(new Date('2025-03-31T21:00:00Z') >= result).toBe(false) // 31 Mar 23:00 AMS
  })

  it('"quarter" on 31 Dec returns Q4 start (1 Oct)', () => {
    const dec31 = new Date('2025-12-31T10:00:00Z')
    const result = dateCreatedThreshold('quarter', dec31)!
    // 1 Oct 00:00 AMS = 2025-09-30T22:00:00Z
    expect(new Date('2025-09-30T23:00:00Z') >= result).toBe(true)
    expect(new Date('2025-09-30T21:00:00Z') >= result).toBe(false)
  })

  it('"year" returns start of 2025', () => {
    const result = dateCreatedThreshold('year', REF)!
    expect(result).not.toBeNull()
    // 1 Jan 00:00 AMS = 2024-12-31T23:00:00Z
    expect(new Date('2024-12-31T23:30:00Z') >= result).toBe(true)
    expect(new Date('2024-12-31T22:30:00Z') >= result).toBe(false)
  })
})
