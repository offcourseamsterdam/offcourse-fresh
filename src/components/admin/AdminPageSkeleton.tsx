function Bar({ className = '' }: { className?: string }) {
  return <div className={`bg-zinc-200 rounded-md animate-pulse ${className}`} />
}

export function AdminPageSkeleton() {
  return (
    <div className="p-6 space-y-6" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <Bar className="h-8 w-48" />
        <div className="flex gap-2">
          <Bar className="h-9 w-28" />
          <Bar className="h-9 w-24" />
        </div>
      </div>

      <Bar className="h-5 w-64" />

      <div className="border border-zinc-200 bg-white rounded-xl p-4 space-y-3">
        <Bar className="h-10 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Bar key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
