'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'password' | 'magic'

/**
 * Sign-in. Password is the default because the magic link has a real cost for
 * a shared mailbox: the sign-in email lands wherever the address is read, so
 * anyone with access to that inbox sees (and can use) the link. A password is
 * personal to whoever knows it.
 *
 * The magic link stays available as a second route, for anyone who has never
 * set a password or has forgotten it.
 *
 * Both routes finish through /auth/set-session, which is what actually
 * establishes the cookie session AND runs resolveProfile — so the deactivated
 * and no-profile gates apply identically no matter how you signed in. Password
 * login deliberately does not shortcut that.
 */
export default function LoginPage() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const urlError = searchParams.get('error')

  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState<null | 'magic' | 'reset'>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const errorMessages: Record<string, string> = {
    auth_failed: 'That sign-in link expired or was already used. Request a new one.',
    missing_code: 'Something went wrong. Please try again.',
    no_profile: 'Account not found. Contact support.',
    no_user: 'Something went wrong. Please try again.',
    deactivated: 'Your account has been deactivated. Contact support.',
  }

  const locale = () => (typeof window === 'undefined' ? 'en' : window.location.pathname.split('/')[1] || 'en')

  function callbackUrl(next?: string) {
    const url = new URL('/auth/callback', window.location.origin)
    const target = next ?? redirect
    if (target) url.searchParams.set('next', target)
    url.searchParams.set('locale', locale())
    return url.toString()
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSubmitError(null)

    const supabase = createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error || !data.session) {
      setLoading(false)
      // Supabase deliberately returns one generic error for "wrong password"
      // and "no such user" so the form can't be used to discover which email
      // addresses have accounts. Mirror that instead of guessing a reason.
      setSubmitError(
        error?.message?.toLowerCase().includes('invalid')
          ? 'Wrong email or password. If you have never set a password, use the email link instead.'
          : error?.message ?? 'Could not sign in. Please try again.',
      )
      return
    }

    // Hand the tokens to the server so it sets the cookie session and decides
    // where this role belongs — same endpoint the magic link finishes through.
    const res = await fetch('/auth/set-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        locale: locale(),
        next: redirect,
      }),
    })
    const body = await res.json().catch(() => null)

    if (!res.ok || !body?.redirect) {
      setLoading(false)
      setSubmitError(errorMessages[body?.error] ?? 'Signed in, but your account could not be loaded.')
      return
    }
    window.location.replace(body.redirect)
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSubmitError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    })

    setLoading(false)
    if (error) {
      setSubmitError('Failed to send the sign-in link. Please try again.')
      return
    }
    setSent('magic')
  }

  async function sendPasswordReset() {
    if (!email) {
      setSubmitError('Enter your email address first, then choose "Forgot password".')
      return
    }
    setLoading(true)
    setSubmitError(null)

    const supabase = createClient()
    // Land on the reset page with a live session, via the same callback the
    // magic link uses — so setting a password needs a working inbox, exactly
    // like every other account recovery.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl(`/${locale()}/reset-password`),
    })

    setLoading(false)
    if (error) {
      setSubmitError('Could not send the reset email. Please try again.')
      return
    }
    setSent('reset')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-sand)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-[var(--color-primary)] font-semibold text-sm tracking-widest uppercase mb-2">
            Off Course Amsterdam
          </p>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">
            {sent ? 'Check your email' : 'Sign in'}
          </h1>
        </div>

        {urlError && errorMessages[urlError] && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {errorMessages[urlError]}
          </div>
        )}

        {sent ? (
          <div className="text-center">
            <div className="mb-4 text-4xl">📬</div>
            <p className="text-[var(--color-primary)] mb-2">
              {sent === 'reset' ? 'Password reset link sent to ' : 'Sign-in link sent to '}
              <strong>{email}</strong>
            </p>
            <p className="text-sm text-gray-500">
              {sent === 'reset'
                ? 'Open it to choose a new password. It expires in 1 hour.'
                : 'Click the link in the email to sign in. It expires in 1 hour.'}
            </p>
            <button
              onClick={() => { setSent(null); setPassword('') }}
              className="mt-6 text-sm text-[var(--color-primary)] underline"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={mode === 'password' ? signInWithPassword : sendMagicLink} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--color-primary)] mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--color-primary)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              />
            </div>

            {mode === 'password' && (
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label htmlFor="password" className="block text-sm font-medium text-[var(--color-primary)]">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={sendPasswordReset}
                    className="text-xs text-[var(--color-primary)] underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--color-primary)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                />
              </div>
            )}

            {submitError && <p className="text-red-600 text-sm">{submitError}</p>}

            <button
              type="submit"
              disabled={loading || !email || (mode === 'password' && !password)}
              className="w-full py-3 px-6 bg-[var(--color-primary)] text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {loading
                ? mode === 'password' ? 'Signing in…' : 'Sending…'
                : mode === 'password' ? 'Sign in' : 'Send sign-in link'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => { setMode(m => (m === 'password' ? 'magic' : 'password')); setSubmitError(null) }}
                className="text-sm text-[var(--color-primary)] underline"
              >
                {mode === 'password' ? 'Email me a sign-in link instead' : 'Sign in with a password instead'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
