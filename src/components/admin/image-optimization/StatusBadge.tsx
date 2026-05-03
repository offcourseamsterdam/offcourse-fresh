import type { ImageAssetStatus } from '@/lib/images/types'

const STYLES: Record<ImageAssetStatus, { bg: string; fg: string; label: string; icon: string }> = {
  pending:    { bg: 'bg-amber-100',  fg: 'text-amber-800',  label: 'Pending',    icon: '⏳' },
  processing: { bg: 'bg-blue-100',   fg: 'text-blue-800',   label: 'Processing', icon: '🔄' },
  complete:   { bg: 'bg-emerald-100', fg: 'text-emerald-800', label: 'Complete',   icon: '✅' },
  failed:     { bg: 'bg-red-100',    fg: 'text-red-800',    label: 'Failed',     icon: '⚠️' },
}

export function StatusBadge({ status }: { status: ImageAssetStatus }) {
  const s = STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.fg}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  )
}
