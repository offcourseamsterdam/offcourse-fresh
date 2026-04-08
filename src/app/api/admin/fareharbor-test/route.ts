import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { getCustomerTypeMap } from '@/lib/fareharbor/config'
import { syncFareHarborItems, loadSyncedItems } from '@/lib/fareharbor/sync'
import { createServiceClient } from '@/lib/supabase/server'

// v2
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const action = searchParams.get('action')

  try {
    const client = getFareHarborClient()

    switch (action) {
      case 'items': {
        const items = await client.getItems()
        return apiOk({ data: items, count: items.length })
      }

      case 'availabilities': {
        const itemPk = Number(searchParams.get('itemPk'))
        const date = searchParams.get('date')
        if (!itemPk || !date) {
          return apiError('itemPk and date are required', 400)
        }
        const availabilities = await client.getAvailabilities(itemPk, date)
        return apiOk({ data: availabilities, count: availabilities.length })
      }

      case 'availability-range': {
        const itemPk = Number(searchParams.get('itemPk'))
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        if (!itemPk || !startDate || !endDate) {
          return apiError('itemPk, startDate and endDate are required', 400)
        }
        const availabilities = await client.getAvailabilitiesDateRange(itemPk, startDate, endDate)
        return apiOk({ data: availabilities, count: availabilities.length })
      }

      case 'availability-detail': {
        const availPk = Number(searchParams.get('availPk'))
        if (!availPk) {
          return apiError('availPk is required', 400)
        }
        const detail = await client.getAvailabilityDetail(availPk)
        return apiOk({ data: detail })
      }

      case 'customer-types': {
        const typeMap = await getCustomerTypeMap()
        const data = Array.from(typeMap.entries()).map(([pk, config]) => ({ ...config, pk }))
        return apiOk({ data, count: data.length })
      }

      case 'supabase-items': {
        const result = await loadSyncedItems()
        if (!result.ok) return apiError(result.error!)
        return apiOk({ data: result.data, count: result.data.length, synced_at: result.synced_at })
      }

      case 'sync-items': {
        const result = await syncFareHarborItems()
        if (!result.ok) return apiError(result.error!)
        const loaded = await loadSyncedItems()
        return apiOk({
          data: loaded.ok ? loaded.data : [],
          count: result.items_count,
          synced_at: result.synced_at,
        })
      }

      case 'listings': {
        const supabase = await createServiceClient()
        const { data, error } = await supabase
          .from('cruise_listings')
          .select('*')
          .order('display_order')
        if (error) return apiError(error.message)
        return apiOk({ data, count: data?.length ?? 0 })
      }

      case 'item-detail': {
        const itemPk = Number(searchParams.get('itemPk'))
        if (!itemPk) return apiError('itemPk required', 400)
        const detail = await client.getItem(itemPk)
        return apiOk({ data: detail })
      }

      default:
        return apiError(`Unknown action: ${action}`, 400)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
