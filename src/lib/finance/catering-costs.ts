export interface ExtraCatalogItem {
  id: string
  name: string
  category: string
  price_value: number
  cost_price_value?: number | null
}

export interface ExtrasSelectedLineItem {
  name: string
  amount_cents: number
  quantity?: number
  category?: string
}

export const DEFAULT_CATERING_COST_CENTS: Record<string, number> = {
  'Bites Box Large (6 guests)': 3250,
  'Bites Box Medium (3-4 guests)': 1750,
  'Bites Box Small (1-2 guests)': 1000,
  'Jamaican Curry Chicken': 850,
  'Jamaican Curry Goat': 1000,
  'Jamaican Oxtail Stew': 1000,
  'Jamaican Buffet': 1450,
  'Jamaican Peppered Prawns': 750,
  'Cheese Platter': 450,
  'Charcuterie Platter': 550,
  'Fruit Platter': 550,
  'Brunch': 2200,
  'Unlimited Drinks': 350,
  'Bring Your Own Drinks': 0,
}

export function resolveItemCostPrice(
  itemName: string,
  catalog?: ExtraCatalogItem[] | null,
): number {
  if (catalog) {
    const found = catalog.find(c => c.name.toLowerCase() === itemName.toLowerCase())
    if (found && typeof found.cost_price_value === 'number' && found.cost_price_value > 0) {
      return found.cost_price_value
    }
  }
  return DEFAULT_CATERING_COST_CENTS[itemName] ?? 0
}

export interface CateringCalculationResult {
  sellingCents: number
  costCents: number
  marginCents: number
  marginPct: number
  itemCount: number
}

export function calculateCateringOrderCosts(
  extrasSelected: ExtrasSelectedLineItem[] | null | undefined,
  catalog?: ExtraCatalogItem[] | null,
): CateringCalculationResult {
  if (!extrasSelected || !Array.isArray(extrasSelected)) {
    return { sellingCents: 0, costCents: 0, marginCents: 0, marginPct: 0, itemCount: 0 }
  }

  let sellingCents = 0
  let costCents = 0
  let itemCount = 0

  for (const item of extrasSelected) {
    const category = item.category?.toLowerCase()
    // Consider food and drinks
    if (category === 'food' || category === 'drinks') {
      const amount = Number(item.amount_cents) || 0
      const qty = Math.max(1, Number(item.quantity) || 1)
      const unitCost = resolveItemCostPrice(item.name, catalog)

      sellingCents += amount
      costCents += unitCost * qty
      itemCount += qty
    }
  }

  const marginCents = Math.max(0, sellingCents - costCents)
  const marginPct = sellingCents > 0 ? Math.round((marginCents / sellingCents) * 100) : 0

  return {
    sellingCents,
    costCents,
    marginCents,
    marginPct,
    itemCount,
  }
}
