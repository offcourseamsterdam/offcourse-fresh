import { SECTION_BY_LABEL } from '@/lib/admin/nav-sections'

/**
 * The small colored label above a page's <h1> ("● Content", "● Marketing"…).
 * Dumb + prop-driven on purpose (no usePathname) so it drops into server or
 * client page components without caring which kind it is — pass the same
 * section label the sidebar uses (see src/lib/admin/nav-sections.ts).
 */
export function AdminEyebrow({ label }: { label: string }) {
  const section = SECTION_BY_LABEL[label]
  if (!section) return null
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: section.ink }}>
      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: section.color }} />
      {section.label}
    </div>
  )
}
