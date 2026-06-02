import { describe, it, expect } from 'vitest'
import { extractAdsError, eurosToMicros, microsToEuros } from './campaign-client'

// extractAdsError is the safety net against the "silent unknown error" trap
// (see google-ads handoff §7.2): a Google rejection must always yield a useful,
// field-pinpointed message, never a bare HTTP code.

describe('extractAdsError', () => {
  it('pulls message + error code + field path out of a GoogleAdsFailure', () => {
    const body = {
      error: {
        code: 3,
        message: 'Request contains an invalid argument.',
        details: [
          {
            '@type': 'type.googleapis.com/google.ads.googleads.v20.errors.GoogleAdsFailure',
            errors: [
              {
                errorCode: { fieldError: 'REQUIRED' },
                message: 'The required field was not present.',
                location: {
                  fieldPathElements: [
                    { fieldName: 'mutate_operations', index: 1 },
                    { fieldName: 'campaign_operation' },
                    { fieldName: 'create' },
                    { fieldName: 'contains_eu_political_advertising' },
                  ],
                },
              },
            ],
          },
        ],
      },
    }
    expect(extractAdsError(body, 400)).toBe(
      'The required field was not present. [fieldError=REQUIRED] at ' +
        'mutate_operations[1].campaign_operation.create.contains_eu_political_advertising',
    )
  })

  it('joins multiple operation errors with a pipe', () => {
    const body = {
      error: {
        message: 'top',
        details: [
          {
            errors: [
              { message: 'first bad', errorCode: { rangeError: 'TOO_LOW' }, location: { fieldPathElements: [{ fieldName: 'a' }] } },
              { message: 'second bad', errorCode: { stringLengthError: 'TOO_LONG' }, location: { fieldPathElements: [{ fieldName: 'b' }] } },
            ],
          },
        ],
      },
    }
    expect(extractAdsError(body, 400)).toBe('first bad [rangeError=TOO_LOW] at a | second bad [stringLengthError=TOO_LONG] at b')
  })

  it('falls back to the top-level message when there are no detail errors', () => {
    expect(extractAdsError({ error: { message: 'Unauthenticated.' } }, 401)).toBe('Unauthenticated.')
  })

  it('uses partialFailureError when present and there is no error block', () => {
    expect(extractAdsError({ partialFailureError: { message: 'op 0 failed' } }, 200)).toBe('op 0 failed')
  })

  it('returns HTTP <status> for a non-object / empty body', () => {
    expect(extractAdsError(null, 404)).toBe('HTTP 404')
    expect(extractAdsError('nope', 500)).toBe('HTTP 500')
    expect(extractAdsError({}, 503)).toBe('HTTP 503')
  })
})

describe('money helpers', () => {
  it('rounds euros → micros', () => {
    expect(eurosToMicros(30)).toBe(30_000_000)
    expect(eurosToMicros(0.01)).toBe(10_000)
    expect(eurosToMicros(12.345)).toBe(12_345_000)
  })
  it('converts micros → euros, accepting Google\'s string form', () => {
    expect(microsToEuros('30000000')).toBe(30)
    expect(microsToEuros(0)).toBe(0)
    expect(microsToEuros('1')).toBe(0.000001)
  })
})
