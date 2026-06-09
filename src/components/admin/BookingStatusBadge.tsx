'use client'

import { Badge } from '@/components/ui/badge'

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'secondary' | 'warning'> = {
  confirmed: 'success',
  booked: 'success',
  cancelled: 'destructive',
  pending_payment: 'warning',
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'awaiting payment',
}

export function BookingStatusBadge({ status }: { status: string | null }) {
  const label = STATUS_LABEL[status ?? ''] ?? status ?? '—'
  const variant = STATUS_VARIANT[status ?? ''] ?? 'secondary'
  return <Badge variant={variant}>{label}</Badge>
}
