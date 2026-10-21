import { afterEach, expect, test, vi } from 'vitest'
import { api, ApiError, fetchMe } from './client'

afterEach(() => vi.unstubAllGlobals())

test('only 401 is treated as not signed in', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
  expect(await fetchMe()).toBeNull()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
    code: 'DATABASE_UNAVAILABLE', message: 'Database belum tersedia.',
  } }), { status: 503 })))
  await expect(fetchMe()).rejects.toBeInstanceOf(ApiError)
})

test('logout supports 204 without trying to parse JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
  expect(await api('/auth/logout', { method: 'POST' })).toBeUndefined()
})
