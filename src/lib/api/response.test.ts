import { describe, it, expect } from 'vitest'
import { apiOk, apiError } from './response'

describe('apiOk', () => {
  it('returns ok:true with data', async () => {
    const res = apiOk({ listings: [1, 2, 3] })
    const body = await res.json()
    expect(body).toEqual({ ok: true, data: { listings: [1, 2, 3] } })
    expect(res.status).toBe(200)
  })

  it('accepts custom status', async () => {
    const res = apiOk({ id: 'new' }, 201)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('works with null data', async () => {
    const res = apiOk(null)
    const body = await res.json()
    expect(body).toEqual({ ok: true, data: null })
  })
})

describe('apiError', () => {
  it('returns ok:false with error message', async () => {
    const res = apiError('Something went wrong')
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Something went wrong' })
    expect(res.status).toBe(500)
  })

  it('accepts custom status', async () => {
    const res = apiError('Not found', 404)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('returns 400 for validation errors', async () => {
    const res = apiError('Invalid date format', 400)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
