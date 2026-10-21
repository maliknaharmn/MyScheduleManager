import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from './App'

const status = { phase: 'foundation', database: 'ready', google_login_configured: false,
  calendar_integration: 'not_implemented', capabilities: { schedules: false, notes: false, calendar_reminders: false },
  auth_handshake_storage: 'single_process_memory' }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>)
  return client
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/me')) return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Login diperlukan.' } }), { status: 401 })
    return new Response(JSON.stringify({ data: status, meta: { request_id: 'test' } }))
  }))
})

test('unconfigured login is disabled and does not pretend to have user data', async () => {
  const client = setup()
  expect(await screen.findByRole('button', { name: /Login menunggu konfigurasi/ })).toBeDisabled()
  expect(screen.getByText('Migrasi terpasang, role API terbatas.')).toBeVisible()
  expect(screen.getByText(/belum MVP lengkap/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /demo|natural language|bahasa alami/i })).not.toBeInTheDocument()
  client.clear()
})

test('configuration guide explains secure local setup', async () => {
  const client = setup()
  await userEvent.click(await screen.findByRole('button', { name: /Lihat panduan konfigurasi/ }))
  expect(screen.getByText('Konfigurasi disimpan di backend/.env')).toBeVisible()
  expect(screen.getByText('http://localhost:5173/api/v1/auth/google/callback')).toBeVisible()
  client.clear()
})

test('network errors are not rendered as an empty private calendar', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const client = setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('Server belum dapat dijangkau')
  expect(screen.queryByText('0 agenda')).not.toBeInTheDocument()
  client.clear()
})
