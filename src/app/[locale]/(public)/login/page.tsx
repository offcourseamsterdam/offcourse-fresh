'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const error = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const errorMessages: Record<string, string> = {
    auth_failed: 'Login link expired or invalid. Please request a new one.',
    missing_code: 'Something went wrong. Please try again.',
    no_profile: 'Account not found. Contact support.',
    deactivated: 'Your account has been deactivated. Contact support.',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSubmitError(null)

    const supabase = createClient()

    // Build the callback URL with redirect info
    const callbackUrl = new URL('/auth/callback', window.location.origin)
    if (redirect) callbackUrl.searchParams.set('next', redirect)
    callbackUrl.searchParams.set('locale', window.location.pathname.split('/')[1] || 'en')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
      },
    })

    setLoading(false)

    if (error) {
      setSubmitError('Failed to send login link. Please try again.')
      return
    }

    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-sand)] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <p className="text-[var(--color-primary)] font-semibold text-sm tracking-widest uppercase mb-2">
            Off Course Amsterdam
          </p>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">
            {sent ? 'Check your email' : 'Sign in'}
          </h1>
        </div>

        {/* Error from URL param */}
        {error && errorMessages[error] && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {errorMessages[error]}
          </div>
        )}

        {sent ? (
          <div className="text-center">
            <div className="mb-4 text-4xl">📬</div>
            <p className="text-[var(--color-primary)] mb-2">
              Magic link sent to <strong>{email}</strong>
            </p>
            <p className="text-sm text-gray-500">
              Click the link in the email to sign in. It expires in 1 hour.
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="mt-6 text-sm text-[var(--color-primary)] underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[var(--color-primary)] mb-1"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--color-primary)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              />
            </div>

            {submitError && (
              <p className="text-red-600 text-sm">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 px-6 bg-[var(--color-primary)] text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {loading ? 'Sending...' : 'Send magic link'}
            </button>

            <p className="text-center text-xs text-gray-400">
              No password needed — we&apos;ll email you a sign-in link.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
