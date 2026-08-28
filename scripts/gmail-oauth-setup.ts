#!/usr/bin/env -S npx tsx
/**
 * gmail-oauth-setup.ts — one-time Gmail OAuth consent for the inbox integration.
 *
 * Run: npx tsx --import ./scripts/_preload-env.mjs --tsconfig tsconfig.scripts.json scripts/gmail-oauth-setup.ts
 *
 * 1. Prints a Google consent URL — open it while logged into the mailbox that
 *    should become the support inbox (GMAIL_USER in .env.local).
 * 2. Approve access. Google redirects to a local server this script starts.
 * 3. The refresh token prints to this terminal — paste it into .env.local as
 *    GMAIL_REFRESH_TOKEN.
 *
 * Uses its own dedicated OAuth client (GMAIL_OAUTH_CLIENT_ID/SECRET), not the
 * shared GOOGLE_OAUTH_CLIENT_ID Google Ads uses — see src/lib/gmail/auth.ts
 * for why. Needs its own consent grant: Google issues refresh tokens scoped
 * to whatever was approved at consent time.
 *
 * Before running: in Google Cloud Console, on this OAuth client, add
 * http://localhost:8945/oauth-callback to "Authorized redirect URIs" if it isn't
 * already there.
 */
import { createServer } from 'node:http'

const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET
const REDIRECT_URI = 'http://localhost:8945/oauth-callback'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET — set them in .env.local first.')
  process.exit(1)
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', CLIENT_ID)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPES.join(' '))
authUrl.searchParams.set('access_type', 'offline')
// Forces Google to issue a refresh_token even if this account consented before —
// without it, a repeat consent silently returns an access token only.
authUrl.searchParams.set('prompt', 'consent')
authUrl.searchParams.set('login_hint', process.env.GMAIL_USER ?? '')

console.log('\n1. Confirm this redirect URI is registered on the OAuth client in Google Cloud Console:')
console.log(`   ${REDIRECT_URI}\n`)
console.log(`2. Open this URL while logged into ${process.env.GMAIL_USER || 'the target mailbox'}:\n`)
console.log(authUrl.toString())
console.log('\n3. Waiting for the redirect on http://localhost:8945 ...\n')

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', REDIRECT_URI)
    const code = url.searchParams.get('code')
    const errorParam = url.searchParams.get('error')
    if (errorParam) {
      res.end(`Google returned an error: ${errorParam}. Check the terminal.`)
      console.error('Consent denied or errored:', errorParam)
      server.close()
      return
    }
    if (!code) {
      res.end('No authorization code in the redirect — see the terminal for details.')
      return
    }
    res.end('Done — check your terminal for the refresh token, then close this tab.')
    server.close()

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const json = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string }
    if (!tokenRes.ok || !json.refresh_token) {
      console.error('Token exchange failed:', json)
      return
    }
    console.log('\nSUCCESS — paste this into .env.local as GMAIL_REFRESH_TOKEN:\n')
    console.log(json.refresh_token)
    console.log()
  })()
})
server.listen(8945)
