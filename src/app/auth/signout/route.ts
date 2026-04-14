import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const locale = request.headers.get('x-locale') || 'en'
  return NextResponse.redirect(new URL(`/${locale}`, request.url))
}
