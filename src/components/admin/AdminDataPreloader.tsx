'use client'

import { useEffect } from 'react'
import { preload } from 'swr'
import { adminFetcher } from '@/hooks/useAdminFetch'

const PRELOAD_URLS = [
  '/api/admin/bookings/local',
  '/api/admin/cruise-listings',
  '/api/admin/extras',
]

export function AdminDataPreloader() {
  useEffect(() => {
    PRELOAD_URLS.forEach(url => preload(url, adminFetcher))
  }, [])
  return null
}
