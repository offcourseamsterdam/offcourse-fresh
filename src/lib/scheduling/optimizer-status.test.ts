import { describe, it, expect } from 'vitest'
import {
  deriveOptimizerState,
  phaseForState,
  isSendable,
  isTerminal,
  type OptimizerDisplayState,
} from './optimizer-status'

describe('deriveOptimizerState', () => {
  it('treats a freshly drafted (shadow) proposal as still possible', () => {
    expect(deriveOptimizerState('shadow', null)).toBe('possible')
  })

  it('treats an unknown/missing status as possible rather than throwing', () => {
    expect(deriveOptimizerState(null, null)).toBe('possible')
    expect(deriveOptimizerState(undefined, null)).toBe('possible')
    expect(deriveOptimizerState('something_new', null)).toBe('possible')
  })

  it('maps the transient send claim to sending', () => {
    expect(deriveOptimizerState('sending', null)).toBe('sending')
  })

  it('maps a sent-but-unanswered proposal to awaiting', () => {
    expect(deriveOptimizerState('approved', {})).toBe('awaiting')
    expect(deriveOptimizerState('proposed', {})).toBe('awaiting')
  })

  it('surfaces guest-accepted-but-not-yet-rebooked as its own state', () => {
    // The case that most needs a human: status is still `approved`, the guest
    // said yes, and nobody has done the FareHarbor rebook.
    expect(deriveOptimizerState('approved', { guest_response: 'accept' })).toBe('accepted')
  })

  it('maps a guest decline to declined even while status is still approved', () => {
    expect(deriveOptimizerState('approved', { guest_response: 'decline' })).toBe('declined')
  })

  it('treats a recorded rebook as finalized even when status lags at approved', () => {
    // mark_rebooked writes outcome.rebooked_at; status is not always advanced.
    expect(
      deriveOptimizerState('approved', { guest_response: 'accept', rebooked_at: '2026-08-27T10:00:00Z' }),
    ).toBe('finalized')
  })

  it('maps status executed to finalized', () => {
    expect(deriveOptimizerState('executed', {})).toBe('finalized')
  })

  it('maps rejected and skipped to declined', () => {
    expect(deriveOptimizerState('rejected', null)).toBe('declined')
    expect(deriveOptimizerState('skipped', null)).toBe('declined')
  })

  it('maps expired to expired', () => {
    expect(deriveOptimizerState('expired', null)).toBe('expired')
  })

  it('lets a completed rebook win over an expired status', () => {
    expect(deriveOptimizerState('expired', { rebooked_at: '2026-08-27T10:00:00Z' })).toBe('finalized')
  })

  it('ignores a defer response, staying in awaiting', () => {
    // A guest asking to decide later is still an open ask.
    expect(deriveOptimizerState('approved', { guest_response: 'defer' })).toBe('awaiting')
  })
})

describe('phaseForState', () => {
  it('buckets every state into exactly one phase', () => {
    const states: OptimizerDisplayState[] = [
      'possible', 'sending', 'awaiting', 'accepted', 'finalized', 'declined', 'expired',
    ]
    for (const s of states) {
      expect(['possible', 'in_progress', 'finalized']).toContain(phaseForState(s))
    }
  })

  it('groups the live states as in progress', () => {
    expect(phaseForState('sending')).toBe('in_progress')
    expect(phaseForState('awaiting')).toBe('in_progress')
    expect(phaseForState('accepted')).toBe('in_progress')
  })

  it('groups every terminal state under finalized', () => {
    expect(phaseForState('finalized')).toBe('finalized')
    expect(phaseForState('declined')).toBe('finalized')
    expect(phaseForState('expired')).toBe('finalized')
  })
})

describe('isSendable / isTerminal', () => {
  it('only an untouched draft is sendable', () => {
    expect(isSendable('possible')).toBe(true)
    for (const s of ['sending', 'awaiting', 'accepted', 'finalized', 'declined', 'expired'] as OptimizerDisplayState[]) {
      expect(isSendable(s)).toBe(false)
    }
  })

  it('marks the three end states as terminal and nothing else', () => {
    expect(isTerminal('finalized')).toBe(true)
    expect(isTerminal('declined')).toBe(true)
    expect(isTerminal('expired')).toBe(true)
    expect(isTerminal('possible')).toBe(false)
    expect(isTerminal('awaiting')).toBe(false)
    expect(isTerminal('accepted')).toBe(false)
  })
})
