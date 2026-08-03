import { describe, it, expect, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { withRoute } from './with-route'
import { apiOk } from './response'

describe('withRoute', () => {
  it('passes through a successful response unchanged', async () => {
    const handler = withRoute(async () => apiOk({ hello: 'world' }))
    const res = await handler()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, data: { hello: 'world' } })
  })

  it('passes through an explicit apiError response unchanged', async () => {
    const handler = withRoute(async () => NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 }))
    const res = await handler()
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Not found' })
  })

  it('catches a thrown Error and returns apiError with its message', async () => {
    const handler = withRoute(async () => {
      throw new Error('Supabase is down')
    })
    const res = await handler()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Supabase is down' })
  })

  it('catches a thrown non-Error value with a generic message', async () => {
    const handler = withRoute(async () => {
      throw 'string boom'
    })
    const res = await handler()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Unknown error' })
  })

  it('forwards all arguments to the wrapped handler', async () => {
    const inner = vi.fn(async (req: { url: string }, ctx: { params: { id: string } }) => apiOk({ url: req.url, id: ctx.params.id }))
    const handler = withRoute(inner)
    const res = await handler({ url: '/x' }, { params: { id: '42' } })
    expect(inner).toHaveBeenCalledWith({ url: '/x' }, { params: { id: '42' } })
    const body = await res.json()
    expect(body.data).toEqual({ url: '/x', id: '42' })
  })
})
