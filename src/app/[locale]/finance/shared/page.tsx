import { cookies } from 'next/headers'
import { isValidFinanceShareToken, FINANCE_SHARE_COOKIE } from '@/lib/auth/finance-share'
import FinancePage from '@/app/[locale]/admin/finance/page'

/**
 * Public entry point for a temporary accountant link — reached only via
 * /api/finance/shared/redeem?token=..., which sets the fs_token cookie this
 * checks. No admin login, no admin sidebar, just this one tab. See
 * migration 107 + src/lib/auth/finance-share.ts.
 */
export default async function SharedFinancePage() {
  const jar = await cookies()
  const token = jar.get(FINANCE_SHARE_COOKIE)?.value
  const valid = token ? await isValidFinanceShareToken(token) : false

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-2">
          <h1 className="text-lg font-semibold text-zinc-900">Link ongeldig of ingetrokken</h1>
          <p className="text-sm text-zinc-500">
            Vraag Beer om een nieuwe link naar dit Finance-overzicht.
          </p>
        </div>
      </div>
    )
  }

  return <FinancePage />
}
