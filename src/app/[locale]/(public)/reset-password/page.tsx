'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Matches the Supabase project's own minimum so the form can say no before
 *  the server does. Keep in step with password_min_length in auth config. */
const MIN_PASSWORD_LENGTH = 10

/**
 * Choose a new password. Reached from the emailed reset link, which lands on
 * /auth/callback first — so by the time this page renders there is already a
 * live session, and updateUser() is authorised as that user.
 *
 * This is also the "set a password for the first time" page: every account
 * here started as magic-link only, so most people arrive with no password at
 * all rather than a forgotten one. The wording avoids assuming either.
 */
export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // No session means the link expired, was already used, or the page was
  // opened directly — say so rather than showing a form that cannot work.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session)
      setReady(true)
    })
  }, [])

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirm && !loading

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    setLoading(false)
    if (updateError) {
      setError(updateError.message || 'Could not save the new password.')
      return
    }
    setDone(true)
  }

  const locale = typeof window === 'undefined' ? 'en' : window.location.pathname.split('/')[1] || 'en'

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-sand)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-[var(--color-primary)] font-semibold text-sm tracking-widest uppercase mb-2">
            Off Course Amsterdam
          </p>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">
            {done ? 'Password saved' : 'Choose a password'}
          </h1>
        </div>

        {!ready && <p className="text-center text-sm text-gray-500">Checking your link…</p>}

        {ready && !authed && !done && (
          <div className="text-center">
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              This link has expired or was already used.
            </div>
            <a href={`/${locale}/login`} className="text-sm text-[var(--color-primary)] underline">
              Back to sign in
            </a>
          </div>
        )}

        {ready && authed && !done && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--color-primary)] mb-1">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--color-primary)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              />
              <p className={`mt-1 text-xs ${tooShort ? 'text-red-600' : 'text-gray-400'}`}>
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-[var(--color-primary)] mb-1">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••••"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--color-primary)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              />
              {mismatch && <p className="mt-1 text-xs text-red-600">Both passwords must match.</p>}
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3 px-6 bg-[var(--color-primary)] text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {loading ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}

        {done && (
          <div className="text-center">
            <div className="mb-4 text-4xl">✅</div>
            <p className="text-[var(--color-primary)] mb-4">
              You can sign in with your email and this password from now on.
            </p>
            <a href={`/${locale}/login`} className="text-sm text-[var(--color-primary)] underline">
              Go to sign in
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
