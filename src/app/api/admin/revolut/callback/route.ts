import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { exchangeAuthCode, getRevolutPrivateKey } from '@/lib/revolut/auth'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error || !code) {
    return new NextResponse(
      `<html>
        <body style="font-family: sans-serif; padding: 40px; background: #09090b; color: #fff;">
          <h2 style="color: #ef4444;">Revolut Koppeling Mislukt</h2>
          <p>${errorDescription || error || 'Geen autorisatiecode ontvangen van Revolut.'}</p>
          <a href="/nl/admin/finance" style="color: #38bdf8;">← Terug naar Finance Cockpit</a>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const clientId = process.env.REVOLUT_CLIENT_ID
  const privateKey = getRevolutPrivateKey()
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const redirectUri = `${protocol}://${host}/api/admin/revolut/callback`

  if (!clientId || !privateKey) {
    return new NextResponse(
      `<html>
        <body style="font-family: sans-serif; padding: 40px; background: #09090b; color: #fff;">
          <h2 style="color: #ef4444;">Configuratiefout</h2>
          <p>REVOLUT_CLIENT_ID of private key ontbreekt op de server.</p>
          <a href="/nl/admin/finance" style="color: #38bdf8;">← Terug naar Finance Cockpit</a>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  try {
    const tokens = await exchangeAuthCode({
      code,
      clientId,
      redirectUri,
      privateKeyPem: privateKey,
    })

    // If running in development, automatically save REVOLUT_REFRESH_TOKEN in .env.local
    if (tokens.refresh_token) {
      const envPath = path.join(process.cwd(), '.env.local')
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8')
        if (envContent.includes('REVOLUT_REFRESH_TOKEN=')) {
          envContent = envContent.replace(
            /REVOLUT_REFRESH_TOKEN=.*/,
            `REVOLUT_REFRESH_TOKEN=${tokens.refresh_token}`
          )
        } else {
          envContent += `\nREVOLUT_REFRESH_TOKEN=${tokens.refresh_token}\n`
        }
        fs.writeFileSync(envPath, envContent, 'utf8')
      }
    }

    return new NextResponse(
      `<html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 60px 20px; background: #09090b; color: #f4f4f5; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
            <h2 style="color: #10b981; margin: 0 0 12px 0;">Revolut Business Succesvol Gekoppeld!</h2>
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
              Je bankrekening is nu live verbonden via de Revolut B2B API. Je actuele EUR saldo en transacties worden vanaf nu automatisch uitgelezen.
            </p>
            <div style="background: #27272a; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #38bdf8; word-break: break-all; margin-bottom: 24px; text-align: left;">
              <strong>Refresh Token opgeslagen:</strong><br/>
              ${tokens.refresh_token ? tokens.refresh_token.slice(0, 15) + '...' + tokens.refresh_token.slice(-10) : 'Geen refresh token'}
            </div>
            <a href="/nl/admin/finance" style="display: inline-block; background: #2563eb; color: #fff; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
              Naar Finance Cockpit →
            </a>
          </div>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  } catch (err: any) {
    return new NextResponse(
      `<html>
        <body style="font-family: sans-serif; padding: 40px; background: #09090b; color: #fff;">
          <h2 style="color: #ef4444;">Fout bij Token Exchange</h2>
          <p>${err.message || 'Onbekende fout'}</p>
          <a href="/nl/admin/finance" style="color: #38bdf8;">← Terug naar Finance Cockpit</a>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
