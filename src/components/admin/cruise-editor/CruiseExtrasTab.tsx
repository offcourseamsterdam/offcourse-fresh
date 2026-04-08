'use client'

import ExtrasTab from '@/components/admin/ExtrasTab'

interface CruiseExtrasTabProps {
  listingId: string
  listingCategory: string
}

export function CruiseExtrasTab({ listingId, listingCategory }: CruiseExtrasTabProps) {
  return <ExtrasTab listingId={listingId} listingCategory={listingCategory} />
}
