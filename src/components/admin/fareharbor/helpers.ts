import type { Rate } from './types'
import { formatAmsterdamTime } from '@/lib/utils'

export function fmtTime(iso: string) {
  return formatAmsterdamTime(iso)
}

export function fmtPrice(cents: number) {
  return `€${(cents / 100).toFixed(0)}`
}

export function ratePrice(rate: Rate): number | undefined {
  return rate.customer_prototype?.total_including_tax ?? rate.customer_prototype?.total
}
