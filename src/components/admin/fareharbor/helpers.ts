import type { Rate } from './types'
import { formatAmsterdamTime, fmtEurosRounded as fmtPrice } from '@/lib/utils'

export function fmtTime(iso: string) {
  return formatAmsterdamTime(iso)
}

export { fmtPrice }

export function ratePrice(rate: Rate): number | undefined {
  return rate.customer_prototype?.total_including_tax ?? rate.customer_prototype?.total
}
