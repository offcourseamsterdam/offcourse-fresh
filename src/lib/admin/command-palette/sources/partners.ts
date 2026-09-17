import { simpleSource } from './simple-source'

export const partnersSource = simpleSource({
  table: 'partners',
  columns: ['name', 'email', 'contact_name', 'phone'],
  group: 'Partners & promo',
  scope: 'partners',
  toItem: row => ({
    id: `partner:${row.id}`,
    kind: 'record',
    group: 'Partners & promo',
    title: String(row.name ?? '—'),
    subtitle: [row.contact_name, row.email].filter(Boolean).join(' · ') || undefined,
    href: `/admin/partners/${row.id}`,
  }),
})

export const promoCodesSource = simpleSource({
  table: 'promo_codes',
  columns: ['code', 'label', 'notes'],
  group: 'Partners & promo',
  scope: 'partners',
  toItem: row => ({
    id: `promo:${row.id}`,
    kind: 'record',
    group: 'Partners & promo',
    title: String(row.code ?? '—'),
    subtitle: (row.label as string | undefined) ?? undefined,
    href: '/admin/promo-codes',
  }),
})
