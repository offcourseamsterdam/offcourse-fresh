import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { createServiceClient } from '@/lib/supabase/server'

// Derive item_type from item name
function deriveItemType(name: string): 'private' | 'shared' {
  return name.toLowerCase().includes('shared') ? 'shared' : 'private'
}

export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get('Authorization')
  const expectedToken = process.env.REVALIDATION_SECRET

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return apiError('Unauthorized', 401)
  }

  try {
    const client = getFareHarborClient()
    const supabase = await createServiceClient()
    const now = new Date().toISOString()

    // Fetch all FareHarbor items
    const items = await client.getItems()

    const summary = {
      items_synced: 0,
    }

    for (const item of items) {
      // Upsert the FareHarbor item
      // Try to find existing item first
      const { data: existing } = await supabase
        .from('fareharbor_items')
        .select('id')
        .eq('fareharbor_pk', item.pk)
        .single()

      let itemId: string | undefined
      let itemError: { message: string } | null = null

      if (existing) {
        // Update metadata only — preserve resources/customer_types from admin sync
        const { error: updateErr } = await supabase
          .from('fareharbor_items')
          .update({
            name: item.name,
            shortname: item.shortname,
            item_type: deriveItemType(item.name),
            is_active: true,
            last_synced_at: now,
          })
          .eq('fareharbor_pk', item.pk)
        itemId = existing.id
        itemError = updateErr
      } else {
        // Insert new item with empty resource/type arrays (populated later by admin sync)
        const { data: inserted, error: insertErr } = await supabase
          .from('fareharbor_items')
          .insert({
            fareharbor_pk: item.pk,
            name: item.name,
            shortname: item.shortname,
            item_type: deriveItemType(item.name),
            is_active: true,
            last_synced_at: now,
            resources: [],
            customer_types: [],
          })
          .select('id')
          .single()
        itemId = inserted?.id
        itemError = insertErr
      }

      if (itemError) {
        console.error(`Error upserting item ${item.pk}:`, itemError)
        continue
      }

      if (!itemId) {
        console.error(`No id returned for item ${item.pk}`)
        continue
      }

      summary.items_synced++
    }

    return apiOk({
      success: true,
      synced_at: now,
      summary,
    })
  } catch (error) {
    console.error('FareHarbor sync error:', error)
    return apiError(error instanceof Error ? error.message : 'Sync failed')
  }
}
