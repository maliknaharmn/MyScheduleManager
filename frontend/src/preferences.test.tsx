import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { act } from 'react'
import { App } from './App'
import type { Me } from './api/client'

test('a background profile update never overwrites a dirty draft or its original version', async () => {
  const me: Me = {
    user: { id: 'test-user', email: 'test@example.invalid', display_name: 'Test' },
    profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 },
    csrf_token: 'test-csrf', calendar: { connection_status: 'not_implemented' },
  }
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      writes.push(JSON.parse(init.body as string))
      return new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Profil sudah berubah.' } }), { status: 409 })
    }
    return new Response(JSON.stringify({ data: url.endsWith('/me') ? me : {
      phase: 'foundation', database: 'ready', google_login_configured: true,
    }, meta: { request_id: 'test' } }))
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter></QueryClientProvider>)
  const input = await screen.findByLabelText('Zona waktu IANA')
  await userEvent.clear(input)
  await userEvent.type(input, 'Asia/Makassar')
  act(() => client.setQueryData<Me>(['me'], { ...me, profile: { ...me.profile, timezone: 'Asia/Tokyo', version: 2 } }))
  expect(input).toHaveValue('Asia/Makassar')
  await userEvent.click(screen.getByRole('button', { name: 'Simpan preferensi' }))
  expect(writes).toEqual([{ timezone: 'Asia/Makassar', daily_reminder_time: '08:00', expected_version: 1 }])
  expect(input).toHaveValue('Asia/Makassar')
  client.clear()
  vi.unstubAllGlobals()
})
