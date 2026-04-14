export default function AccountBookingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-primary)] mb-2">My Bookings</h1>
      <p className="text-gray-500 mb-8">Your past and upcoming trips with Off Course.</p>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <p className="text-gray-400 text-sm text-center py-8">
          No bookings yet. Ready to get on the water?
        </p>
      </div>
    </div>
  )
}
