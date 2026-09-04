import { describe, it, expect } from 'vitest'
import { detectFinanceInvoice, type DetectFinanceInvoiceInput } from './detect'

const FINANCE_ADDRESS = 'facturen@offcourseamsterdam.com'

const input = (o: Partial<DetectFinanceInvoiceInput> = {}): DetectFinanceInvoiceInput => ({
  toAddresses: [FINANCE_ADDRESS],
  fromEmail: 'onbekend@voorbeeld.nl',
  financeAddress: FINANCE_ADDRESS,
  knownStaff: [{ id: 's1', email: 'mare@offcourseamsterdam.com' }],
  knownSuppliers: [{ id: 'sup1', email: 'facturen@jachthavenwesterdok.nl' }],
  ...o,
})

describe('detectFinanceInvoice — only fires for the finance alias', () => {
  it('returns null when the message was not addressed to the finance alias', () => {
    expect(detectFinanceInvoice(input({ toAddresses: ['info@offcourseamsterdam.com'] }))).toBeNull()
  })

  it('returns null when GMAIL_FINANCE_ADDRESS is unset, even if the To header happens to match', () => {
    expect(detectFinanceInvoice(input({ financeAddress: null }))).toBeNull()
    expect(detectFinanceInvoice(input({ financeAddress: undefined }))).toBeNull()
  })

  it('matches case-insensitively and among several recipients', () => {
    expect(detectFinanceInvoice(input({ toAddresses: ['Info@OffCourseAmsterdam.com', 'Facturen@OffCourseAmsterdam.com'] })))
      .not.toBeNull()
  })
})

describe('detectFinanceInvoice — trust only known senders', () => {
  it('recognises a staff member by email', () => {
    const d = detectFinanceInvoice(input({ fromEmail: 'Mare@OffCourseAmsterdam.com' }))
    expect(d).toEqual({ category: 'finance', senderKind: 'staff', staffId: 's1', supplierId: null, trusted: true })
  })

  it('recognises a known supplier by email', () => {
    const d = detectFinanceInvoice(input({ fromEmail: 'facturen@jachthavenwesterdok.nl' }))
    expect(d).toEqual({ category: 'finance', senderKind: 'supplier', staffId: null, supplierId: 'sup1', trusted: true })
  })

  it('flags an unknown sender as untrusted, but still tags it finance so it stays visible', () => {
    const d = detectFinanceInvoice(input({ fromEmail: 'iemand@willekeurig.nl' }))
    expect(d).toEqual({ category: 'finance', senderKind: 'unknown', staffId: null, supplierId: null, trusted: false })
  })

  it('never trusts a staff/supplier match on name alone, only on the email address', () => {
    const d = detectFinanceInvoice(input({
      fromEmail: 'mare.impersonator@willekeurig.nl',
      knownStaff: [{ id: 's1', email: null }],
    }))
    expect(d?.trusted).toBe(false)
  })
})
