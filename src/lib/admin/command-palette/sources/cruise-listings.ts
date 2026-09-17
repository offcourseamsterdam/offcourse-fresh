import { simpleSource } from './simple-source'

/** No scope prefix reserved for these — reachable only via an unscoped query, per the build plan. */
export const cruiseListingsSource = simpleSource({
  table: 'cruise_listings',
  columns: ['title', 'slug', 'tagline', 'category'],
  group: 'Cruises',
  toItem: row => ({
    id: `cruise:${row.id}`,
    kind: 'record',
    group: 'Cruises',
    title: String(row.title ?? '—'),
    subtitle: (row.category as string | undefined) ?? undefined,
    href: `/admin/cruises/${row.id}`,
  }),
})
