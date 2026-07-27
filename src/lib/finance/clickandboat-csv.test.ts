import { describe, it, expect } from 'vitest'
import { parseClickAndBoatCsv } from './clickandboat-csv'

// Fixture matches the real "Download the summary" export from
// clickandboat.com/en/account/bookings (headers + two real rows, one of
// them the outlier booking with a different gross/net amount).
const SAMPLE_CSV = `"No. charter","Listing title","Charter start date","Charter end date","Duration (days)","Gross amount (€)","Net amount (€)","Bank transfer",Location
1208047,"#191286 - Off the beaten path Canal Cruise",13-09-2025,13-09-2025,0.5,250,197,15-09-2025,Pays-Bas
1186969,"#191286 - Off the beaten path Canal Cruise",24-08-2025,24-08-2025,0.5,330,261,27-08-2025,Pays-Bas`

describe('parseClickAndBoatCsv', () => {
  it('parses every booking row', () => {
    const rows = parseClickAndBoatCsv(SAMPLE_CSV)
    expect(rows).toHaveLength(2)
  })

  it('converts DD-MM-YYYY dates to ISO', () => {
    const rows = parseClickAndBoatCsv(SAMPLE_CSV)
    expect(rows[0].startDate).toBe('2025-09-13')
    expect(rows[0].endDate).toBe('2025-09-13')
    expect(rows[0].bankTransferDate).toBe('2025-09-15')
  })

  it('converts euro amounts to integer cents', () => {
    const rows = parseClickAndBoatCsv(SAMPLE_CSV)
    expect(rows[0].grossAmountCents).toBe(25000)
    expect(rows[0].netAmountCents).toBe(19700)
  })

  it('keeps the charter number, listing title, duration and location', () => {
    const rows = parseClickAndBoatCsv(SAMPLE_CSV)
    expect(rows[0].charterNumber).toBe('1208047')
    expect(rows[0].listingTitle).toBe('#191286 - Off the beaten path Canal Cruise')
    expect(rows[0].durationDays).toBe(0.5)
    expect(rows[0].location).toBe('Pays-Bas')
  })

  it('handles a booking whose gross/net differ from the usual €250/€197', () => {
    const rows = parseClickAndBoatCsv(SAMPLE_CSV)
    expect(rows[1].grossAmountCents).toBe(33000)
    expect(rows[1].netAmountCents).toBe(26100)
  })

  it('skips rows with no charter number rather than crashing', () => {
    const csv = `"No. charter","Listing title","Charter start date","Charter end date","Duration (days)","Gross amount (€)","Net amount (€)","Bank transfer",Location\n,,,,,,,,`
    expect(parseClickAndBoatCsv(csv)).toEqual([])
  })

  it('returns an empty array for a header-only or empty file', () => {
    expect(parseClickAndBoatCsv('')).toEqual([])
    expect(parseClickAndBoatCsv('"No. charter","Listing title"')).toEqual([])
  })
})
