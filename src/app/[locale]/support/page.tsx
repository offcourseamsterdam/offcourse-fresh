export default function SupportDashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[var(--color-primary)] mb-2">Support Dashboard</h1>
      <p className="text-gray-500">Manage bookings, content, and operations.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        {[
          { label: 'Open bookings', value: '—' },
          { label: 'Pending changes', value: '—' },
          { label: 'Messages', value: '—' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-400 mb-2">{card.label}</p>
            <p className="text-3xl font-bold text-[var(--color-primary)]">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
