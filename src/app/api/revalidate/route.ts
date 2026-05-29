import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { path } = await request.json()
  revalidatePath(path ?? '/', 'page')
  return NextResponse.json({ revalidated: true, path })
}

// Allow GET for quick browser-triggered purges (authenticated by secret param)
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const path = request.nextUrl.searchParams.get('path') ?? '/'
  revalidatePath(path, 'page')
  return NextResponse.json({ revalidated: true, path })
}
