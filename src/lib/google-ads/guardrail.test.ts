import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateGuardrail, formatAlerts, selectAutoPause, formatPauses, type GuardrailConfig } from './guardrail'
import type { PerformanceRow } from './reporting'

const perf = (over: Partial<PerformanceRow>): PerformanceRow => ({
  id: '1', name: 'C', impressions: 0, clicks: 0, ctr: 0, costEuros: 0,
  conversions: 0, conversionValueEuros: 0, avgCpcEuros: 0, costPerConversionEuros: null, roas: null,
  ...over,
})
const cfg: GuardrailConfig = { spendCapEuros: 1000, zeroBookingBurnEuros: 50 }

describe('evaluateGuardrail', () => {
  it('flags a campaign over the spend cap', () => {
    const a = evaluateGuardrail([perf({ name: 'Big', costEuros: 1200, conversions: 10, conversionValueEuros: 3000 })], cfg)
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('overspend')
  })

  it('flags spend with zero bookings (the burn case)', () => {
    const a = evaluateGuardrail([perf({ name: 'Dud', costEuros: 80, conversions: 0 })], cfg)
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('zero_booking_burn')
  })

  it('does NOT flag a small zero-booking spend below the floor (still warming up)', () => {
    expect(evaluateGuardrail([perf({ costEuros: 20, conversions: 0 })], cfg)).toHaveLength(0)
  })

  it('flags a campaign that has bookings but is losing money', () => {
    const a = evaluateGuardrail([perf({ name: 'Leak', costEuros: 200, conversions: 1, conversionValueEuros: 120 })], cfg)
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('losing_money')
  })

  it('does NOT flag a healthy profitable campaign', () => {
    expect(evaluateGuardrail([perf({ costEuros: 100, conversions: 5, conversionValueEuros: 800 })], cfg)).toHaveLength(0)
  })

  it('can flag overspend AND losing on the same campaign', () => {
    const a = evaluateGuardrail([perf({ name: 'X', costEuros: 1500, conversions: 2, conversionValueEuros: 200 })], cfg)
    expect(a.map(x => x.kind).sort()).toEqual(['losing_money', 'overspend'])
  })
})

describe('formatAlerts', () => {
  it('returns empty string when nothing fired', () => {
    expect(formatAlerts([])).toBe('')
  })
  it('renders a Slack message listing each alert', () => {
    const msg = formatAlerts([{ campaignId: '1', campaignName: 'Dud', kind: 'zero_booking_burn', message: '€80 spent, 0 bookings — consider pausing' }])
    expect(msg).toContain('Google Ads guardrail')
    expect(msg).toContain('*Dud*')
    expect(msg).toContain('0 bookings')
  })
})

const pauseCfg: GuardrailConfig = { spendCapEuros: 1000, zeroBookingBurnEuros: 50, autoPause: true, autoPauseZeroBookingEuros: 200 }

describe('selectAutoPause', () => {
  it('returns nothing when autoPause is off, even past the bleed line', () => {
    const targets = selectAutoPause([perf({ costEuros: 500, conversions: 0 })], { ...pauseCfg, autoPause: false })
    expect(targets).toHaveLength(0)
  })

  it('pauses a campaign at/over the hard-bleed line with zero bookings', () => {
    const targets = selectAutoPause([perf({ name: 'Bleeder', costEuros: 250, conversions: 0 })], pauseCfg)
    expect(targets).toHaveLength(1)
    expect(targets[0].campaignName).toBe('Bleeder')
    expect(targets[0].reason).toContain('0 bookings')
  })

  it('does NOT pause while still under the bleed line (week-1 learning)', () => {
    // €120 spent, no bookings yet → Slack alert fires, but no auto-pause.
    expect(selectAutoPause([perf({ costEuros: 120, conversions: 0 })], pauseCfg)).toHaveLength(0)
  })

  it('does NOT pause a campaign that has at least one booking (even if losing money)', () => {
    expect(selectAutoPause([perf({ costEuros: 400, conversions: 1, conversionValueEuros: 50 })], pauseCfg)).toHaveLength(0)
  })

  it('uses the default €200 line when none is given', () => {
    const cfg: GuardrailConfig = { spendCapEuros: 1000, zeroBookingBurnEuros: 50, autoPause: true }
    expect(selectAutoPause([perf({ costEuros: 199, conversions: 0 })], cfg)).toHaveLength(0)
    expect(selectAutoPause([perf({ costEuros: 200, conversions: 0 })], cfg)).toHaveLength(1)
  })
})

describe('formatPauses', () => {
  it('returns empty string when nothing was paused', () => {
    expect(formatPauses([])).toBe('')
  })
  it('announces auto-paused campaigns', () => {
    const msg = formatPauses([{ campaignId: '1', campaignName: 'Bleeder', reason: '€250 spent, 0 bookings (≥ €200 hard-bleed line)' }])
    expect(msg).toContain('AUTO-PAUSED')
    expect(msg).toContain('*Bleeder*')
    expect(msg).toContain('Re-enable')
  })
})

// runGuardrail is the I/O wrapper — it's the only place that actually flips a
// campaign to PAUSED, so it's the only place that should ever emit
// 'ads_campaign_paused'. A campaign that only trips a Slack alert (no pause)
// must NOT emit anything — the event log is for real automated actions, not
// warnings a human still has to act on.
const h = vi.hoisted(() => ({
  campaignPerformance: vi.fn(),
  setCampaignStatus: vi.fn(),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./reporting', () => ({ campaignPerformance: h.campaignPerformance }))
vi.mock('./campaigns', () => ({ setCampaignStatus: h.setCampaignStatus }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))

describe('runGuardrail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits ads_campaign_paused when a campaign is actually auto-paused', async () => {
    const { runGuardrail } = await import('./guardrail')
    h.campaignPerformance.mockResolvedValue({
      ok: true,
      rows: [perf({ id: '42', name: 'Bleeder', costEuros: 250, conversions: 0 })],
    })
    h.setCampaignStatus.mockResolvedValue({ ok: true })

    const res = await runGuardrail({ ...pauseCfg }, 30)

    expect(res.paused).toHaveLength(1)
    expect(h.emitOpsEvent).toHaveBeenCalledTimes(1)
    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ads_campaign_paused',
        actorType: 'system',
        source: 'google-ads/guardrail',
        payload: expect.objectContaining({ campaignId: '42', campaignName: 'Bleeder' }),
      }),
    )
  })

  it('does NOT emit ads_campaign_paused for a campaign that only trips a Slack alert', async () => {
    const { runGuardrail } = await import('./guardrail')
    // Over the spend cap → alert-worthy, but nowhere near the hard-bleed line,
    // and autoPause is off in this config — nothing should be paused.
    h.campaignPerformance.mockResolvedValue({
      ok: true,
      rows: [perf({ id: '7', name: 'Big', costEuros: 1200, conversions: 10, conversionValueEuros: 3000 })],
    })

    const res = await runGuardrail(cfg, 30)

    expect(res.paused).toHaveLength(0)
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit when setCampaignStatus fails (the pause did not actually happen)', async () => {
    const { runGuardrail } = await import('./guardrail')
    h.campaignPerformance.mockResolvedValue({
      ok: true,
      rows: [perf({ id: '42', name: 'Bleeder', costEuros: 250, conversions: 0 })],
    })
    h.setCampaignStatus.mockResolvedValue({ ok: false, error: 'boom' })

    const res = await runGuardrail({ ...pauseCfg }, 30)

    expect(res.paused).toHaveLength(0)
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
  })
})
