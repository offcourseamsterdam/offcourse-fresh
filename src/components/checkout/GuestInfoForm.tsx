'use client'

import { useState } from 'react'
import type { CustomerDetails } from '@/types'

interface GuestInfoFormProps {
  onSubmit: (details: CustomerDetails & { partnerCode?: string }) => void
  loading?: boolean
  requirePartnerCode?: boolean
  partnerName?: string | null
  submitLabel?: string
}

export function GuestInfoForm({
  onSubmit,
  loading,
  requirePartnerCode = false,
  partnerName,
  submitLabel,
}: GuestInfoFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [specialRequests, setSpecialRequests] = useState('')
  const [partnerCode, setPartnerCode] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Name is required'
    if (!email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Please enter a valid email'
    if (!phone.trim()) errs.phone = 'Phone number is required'
    if (requirePartnerCode && !partnerCode.trim()) errs.partnerCode = 'Please enter the code from your receipt'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      specialRequests: specialRequests.trim() || undefined,
      partnerCode: requirePartnerCode ? partnerCode.trim() : undefined,
    })
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

      {/* Partner code — only shown for partner-invoice listings */}
      {requirePartnerCode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <label htmlFor="partner-code" className="block text-sm font-semibold text-amber-900 mb-1">
            Partner code {partnerName ? `from ${partnerName}` : ''}
          </label>
          <p className="text-xs text-amber-800 mb-2">
            Type the code printed on your receipt from the partner desk.
          </p>
          <input
            id="partner-code"
            type="text"
            value={partnerCode}
            onChange={e => setPartnerCode(e.target.value)}
            placeholder="WBKA-2X9F"
            autoComplete="off"
            spellCheck={false}
            className={`w-full px-4 py-2.5 rounded-xl border bg-white text-sm uppercase tracking-widest font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 ${
              errors.partnerCode ? 'border-red-400' : 'border-amber-200'
            }`}
          />
          {errors.partnerCode && <p className="text-xs text-red-600 mt-1">{errors.partnerCode}</p>}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white text-sm font-bold hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading
          ? (requirePartnerCode ? 'Confirming booking…' : 'Setting up payment…')
          : (submitLabel ?? 'Continue to payment')}
      </button>
    </form>
  )
}
