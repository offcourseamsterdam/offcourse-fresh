export default function CaptainSchedulePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[var(--color-primary)] mb-2">My Schedule</h1>
      <p className="text-gray-500">Your upcoming trips will appear here.</p>

      <div className="mt-8 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <p className="text-gray-400 text-sm text-center py-8">
          No upcoming trips scheduled. Check back soon.
        </p>
      </div>
    </div>
  )
}
