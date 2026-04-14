interface CategoryBadgeProps {
  isPrivate: boolean
}

export function CategoryBadge({ isPrivate }: CategoryBadgeProps) {
  return (
    <span className={`inline-block text-xs font-avenir font-bold uppercase tracking-wider px-3 py-1 rounded-full ${
      isPrivate ? 'bg-primary text-white' : 'bg-cta text-primary'
    }`}>
      {isPrivate ? 'Private Tour' : 'Shared Experience'}
    </span>
  )
}
