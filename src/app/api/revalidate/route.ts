import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

// Only site paths may be purged — a leading slash, no scheme/host tricks.
// Keeps a leaked/shared secret from being used to purge arbitrary cache keys.
function isValidPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
}

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!process.env.REVALIDATION_SECRET || secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { path } = await request.json()
  if (path !== undefined && !isValidPath(path)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  revalidatePath(path ?? '/', 'page')
  return NextResponse.json({ revalidated: true, path: path ?? '/' })
}

// Allow GET for quick browser-triggered purges (authenticated by secret param)
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!process.env.REVALIDATION_SECRET || secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const path = request.nextUrl.searchParams.get('path') ?? '/'
  if (!isValidPath(path)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  revalidatePath(path, 'page')
  return NextResponse.json({ revalidated: true, path })
}
