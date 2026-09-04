/**
 * The category tree every bank transaction is sorted into.
 *
 * Follows the PRD's "small, understandable classification system" (§22), with
 * two additions the real Revolut feed made unavoidable:
 *   - operating/crew: skipper payments are the single largest outgoing group,
 *     and burying them in "other operating costs" would hide the biggest lever
 *     the business has.
 *   - operating/catering: drinks and food bought for on board (Taste Vin,
 *     Drankengilde, Marqt) is a cost of sale, not general overhead.
 *
 * Classification answers "what is this?". Allocation (which bucket of the
 * cockpit it touches) is derived from it in allocation-effect.ts, so the two
 * stay separate exactly as the PRD asks (§20).
 */

export const CATEGORIES = {
  income: {
    label: 'Inkomsten',
    subcategories: {
      booking: 'Boekingen',
      onboard: 'Aan boord verkocht',
      other: 'Overige inkomsten',
    },
  },
  operating: {
    label: 'Operationele kosten',
    subcategories: {
      crew: 'Schippers en bemanning',
      catering: 'Catering en drank',
      fuel: 'Brandstof en laden',
      insurance: 'Verzekering',
      mooring: 'Ligplaats',
      software: 'Software en tools',
      marketing: 'Marketing',
      fees: 'Bank- en transactiekosten',
      other: 'Overige operationele kosten',
    },
  },
  maintenance: {
    label: 'Onderhoud',
    subcategories: {
      engine: 'Motor',
      batteries: 'Accu\'s',
      hull: 'Romp',
      electrical: 'Elektra',
      winter: 'Winteronderhoud',
      other: 'Overig onderhoud',
    },
  },
  upgrade: {
    label: 'Upgrades',
    subcategories: {
      equipment: 'Uitrusting',
      comfort: 'Comfort',
      operational: 'Operationele upgrades',
    },
  },
  investment: {
    label: 'Investeringen',
    subcategories: {
      boat: 'Boot',
      equipment: 'Groot materieel',
      growth: 'Groei',
      strategic: 'Strategisch',
    },
  },
  financing: {
    label: 'Financiering',
    subcategories: {
      loan_received: 'Lening ontvangen',
      loan_repayment: 'Aflossing',
      interest: 'Rente',
    },
  },
  tax: {
    label: 'Belastingen',
    subcategories: {
      vat: 'BTW',
      city_tax: 'Toeristenbelasting',
      other: 'Overige belastingen',
    },
  },
  owner: {
    label: 'Eigenaar',
    subcategories: {
      salary: 'Eigenaarssalaris',
      contribution: 'Inleg',
      withdrawal: 'Opname',
    },
  },
  transfer: {
    label: 'Interne overboeking',
    subcategories: {
      internal: 'Tussen eigen rekeningen',
    },
  },
} as const

export type Category = keyof typeof CATEGORIES
export type Subcategory<C extends Category = Category> = keyof (typeof CATEGORIES)[C]['subcategories']

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]

export function isCategory(value: string): value is Category {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, value)
}

export function isSubcategory(category: string, subcategory: string): boolean {
  if (!isCategory(category)) return false
  return Object.prototype.hasOwnProperty.call(CATEGORIES[category].subcategories, subcategory)
}

export function categoryLabel(category: string | null | undefined): string {
  if (!category || !isCategory(category)) return 'Niet geclassificeerd'
  return CATEGORIES[category].label
}

export function subcategoryLabel(category: string | null | undefined, subcategory: string | null | undefined): string | null {
  if (!category || !subcategory || !isCategory(category)) return null
  const subs = CATEGORIES[category].subcategories as Record<string, string>
  return subs[subcategory] ?? null
}

/** "Operationele kosten · Schippers en bemanning", for chips and lists. */
export function fullLabel(category: string | null | undefined, subcategory: string | null | undefined): string {
  const cat = categoryLabel(category)
  const sub = subcategoryLabel(category, subcategory)
  return sub ? `${cat} · ${sub}` : cat
}

/**
 * Categories that may only ever appear on money coming in / going out.
 * A rule or an AI answer that violates this is rejected rather than stored,
 * because a misfiled sign silently corrupts every total downstream.
 */
export const INCOME_ONLY: ReadonlySet<Category> = new Set<Category>(['income'])
export const EXPENSE_ONLY: ReadonlySet<Category> = new Set<Category>([
  'operating',
  'maintenance',
  'upgrade',
  'investment',
  'tax',
])

export function directionAllows(category: Category, amountCents: number): boolean {
  // Zero-amount rows carry no direction, so nothing to contradict.
  if (amountCents === 0) return true
  const incoming = amountCents > 0
  if (incoming && EXPENSE_ONLY.has(category)) return false
  if (!incoming && INCOME_ONLY.has(category)) return false
  return true
}
