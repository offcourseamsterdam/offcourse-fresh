import type { Rate } from './types'

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
  })
}

export function fmtPrice(cents: number) {
  return `€${(cents / 100).toFixed(0)}`
}

export function ratePrice(rate: Rate): number | undefined {
  return rate.customer_prototype?.total_including_tax ?? rate.customer_prototype?.total
}
