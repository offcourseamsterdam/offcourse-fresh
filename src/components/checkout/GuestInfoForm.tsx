'use client'

import { useState } from 'react'
import type { CustomerDetails } from '@/types'

interface GuestInfoFormProps {
  onSubmit: (details: CustomerDetails) => void
  loading?: boolean
}

export function GuestInfoForm({ onSubmit, loading }: GuestInfoFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [specialRequests, setSpecialRequests] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Name is required'
    if (!email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Please enter a valid email'
    if (!phone.trim()) errs.phone = 'Phone number is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    onSubmit({ name: name.trim(), email: email.trim(), phone: phone.trim(), specialRequests: specialRequests.trim() || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-lg font-bold text-zinc-900">Your details</h2>

      {/* Full name */}
      <div>
        <label htmlFor="guest-name" className="block text-sm font-medium text-zinc-700 mb-1">
          Full name
        </label>
        <input
          id="guest-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your full name"
          className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] ${
            errors.name ? 'border-red-400' : 'border-zinc-200'
          }`}
        />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="guest-email" className="block text-sm font-medium text-zinc-700 mb-1">
          Email
        </label>
        <input
          id="guest-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] ${
            errors.email ? 'border-red-400' : 'border-zinc-200'
          }`}
        />
        {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
        <p className="text-xs text-zinc-400 mt-1">We&apos;ll send your confirmation here</p>
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="guest-phone" className="block text-sm font-medium text-zinc-700 mb-1">
          Phone number
        </label>
        <input
          id="guest-phone"
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="+31 6 1234 5678"
          className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] ${
            errors.phone ? 'border-red-400' : 'border-zinc-200'
          }`}
        />
        {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
      </div>

      {/* Special requests */}
      <div>
        <label htmlFor="guest-special" className="block text-sm font-medium text-zinc-700 mb-1">
          Celebrating something special?
        </label>
        <textarea
          id="guest-special"
          value={specialRequests}
          onChange={e => setSpecialRequests(e.target.value)}
          placeholder="Birthday, anniversary, proposal... we love making it extra"
          rows={3}
          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] resize-none"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white text-sm font-bold hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Setting up payment...' : 'Continue to payment'}
      </button>
    </form>
  )
}
