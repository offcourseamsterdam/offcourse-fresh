'use client'

import { Badge } from '@/components/ui/badge'

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'secondary'> = {
  confirmed: 'success',
  booked: 'success',
  cancelled: 'destructive',
}

export function BookingStatusBadge({ status }: { status: string | null }) {
  return (
    <Badge variant={STATUS_VARIANT[status ?? ''] ?? 'secondary'}>
      {status ?? '—'}
    </Badge>
  )
}
