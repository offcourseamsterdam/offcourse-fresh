import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidStockToken } from '@/lib/stock/stock-token'
import StockCountClient from './StockCountClient'

// No cache — a rotated STOCK_TOKEN_SECRET must invalidate old QRs instantly.
export const revalidate = 0

interface Props {
  params: Promise<{ locale: string; token: string }>
}

export default async function StockCountPage({ params }: Props) {
  const { token } = await params
  if (!isValidStockToken(token)) notFound()

  const supabase = createAdminClient()
  const { data: items } = await supabase
    .from('stock_items')
    .select('id, name, category, unit, pack_size, pack_unit, location, current_count')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  return <StockCountClient token={token} items={items ?? []} />
}
