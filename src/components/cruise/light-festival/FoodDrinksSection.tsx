'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Cookie, Wine } from 'lucide-react'
import { ExtraDetailModal, type ExtraItem } from '../ExtrasGrid'
import { foodTabFor, type FoodTab } from '@/lib/cruise/light-festival'

interface FoodDrinksSectionProps {
  foodExtras: ExtraItem[]
  drinkExtras: ExtraItem[]
  headingClassName: string
}

const TABS: { key: FoodTab; label: string }[] = [
  { key: 'snacks', label: 'Snacks' },
  { key: 'meals', label: 'Lunch & dinner' },
]

// Light Festival take on "Things you need to know": one calm card, two groups
// (Snacks & bites with tabs, then Drinks & bar), items as an even two-column grid.
export function FoodDrinksSection({ foodExtras, drinkExtras, headingClassName }: FoodDrinksSectionProps) {
  const [modalExtra, setModalExtra] = useState<ExtraItem | null>(null)

  const byTab: Record<FoodTab, ExtraItem[]> = { snacks: [], meals: [] }
  for (const extra of foodExtras) byTab[foodTabFor(extra.name)].push(extra)
  const visibleTabs = TABS.filter(t => byTab[t.key].length > 0)
  const [tab, setTab] = useState<FoodTab>(visibleTabs[0]?.key ?? 'snacks')
  const activeTab = visibleTabs.some(t => t.key === tab) ? tab : visibleTabs[0]?.key

  if (foodExtras.length === 0 && drinkExtras.length === 0) return null

  return (
    <section>
      <h2 className={headingClassName}>Food &amp; drinks on board</h2>
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-4 sm:p-6 space-y-8">
        {visibleTabs.length > 0 && activeTab && (
          <div>
            <GroupHeader icon={<Cookie className="w-4 h-4" />} label="Food" />
            {visibleTabs.length > 1 && (
              <div role="tablist" aria-label="Food menu" className="flex gap-2 mt-4">
                {visibleTabs.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.key}
                    onClick={() => setTab(t.key)}
                    className={`min-h-[44px] px-5 rounded-full text-sm font-semibold transition-colors ${
                      activeTab === t.key
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-[var(--color-sand)] text-[var(--color-ink)] hover:bg-zinc-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {activeTab === 'meals' && (
              <p className="mt-4 text-sm text-[var(--color-muted)]">Sit-down meals are only possible on Curaçao (up to 12 guests).</p>
            )}
            <ItemGrid items={byTab[activeTab]} onSelect={setModalExtra} />
          </div>
        )}

        {drinkExtras.length > 0 && (
          <div>
            <GroupHeader icon={<Wine className="w-4 h-4" />} label="Drinks & bar" />
            <ItemGrid items={drinkExtras} onSelect={setModalExtra} />
          </div>
        )}
      </div>

      {modalExtra && <ExtraDetailModal extra={modalExtra} onClose={() => setModalExtra(null)} />}
    </section>
  )
}

function GroupHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
      <span className="text-amber-500">{icon}</span>
      <h3 className="font-avenir font-bold text-base text-[var(--color-primary)]">{label}</h3>
    </div>
  )
}

function ItemGrid({ items, onSelect }: { items: ExtraItem[]; onSelect: (e: ExtraItem) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
      {items.map(extra => (
        <button
          key={extra.id}
          type="button"
          onClick={() => onSelect(extra)}
          className="text-left flex items-center gap-3 rounded-xl border border-zinc-200 p-2.5 min-h-[72px] hover:border-[var(--color-primary)] hover:bg-[var(--color-sand)]/40 transition-colors"
        >
          {/* No photo, no box — an empty grey square reads as "broken". */}
          {extra.image_url && (
            <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-100">
              <Image src={extra.image_url} alt="" fill sizes="56px" className="object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-[var(--color-ink)] leading-snug">{extra.name}</p>
            <p className="font-bold text-sm text-[var(--color-primary)]">{extra.price_display}</p>
            {extra.min_people && extra.min_people > 0 ? (
              <p className="text-xs text-[var(--color-muted)]">min. {extra.min_people} people</p>
            ) : extra.description ? (
              <p className="text-xs text-[var(--color-muted)] line-clamp-1">{extra.description}</p>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  )
}
