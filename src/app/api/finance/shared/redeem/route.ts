import { NextRequest, NextResponse } from 'next/server'
import { isValidFinanceShareToken, FINANCE_SHARE_COOKIE } from '@/lib/auth/finance-share'

/**
 * GET /api/finance/shared/redeem?token=...
 *
 * One-time entry point for a temporary accountant link (see migration 107,
 * src/lib/auth/finance-share.ts). Validates the token, sets it as an
 * httpOnly cookie, and redirects to the actual Finance-tab page — after
 * this the token never appears in the URL bar again, only the cookie.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const valid = await isValidFinanceShareToken(token)

  const dest = new URL('/en/finance/shared', req.url)
  if (!valid) dest.searchParams.set('invalid', '1')

  const res = NextResponse.redirect(dest)
  if (valid) {
    res.cookies.set(FINANCE_SHARE_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }
  return res
}
