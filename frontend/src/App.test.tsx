import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from './App'

const status = { phase: 'foundation', database: 'ready', google_login_configured: false,
  calendar_integration: 'not_implemented', capabilities: { schedules: false, notes: false, calendar_reminders: false },
  auth_handshake_storage: 'single_process_memory' }

function setup(entry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><App /></MemoryRouter></QueryClientProvider>)
  return client
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/me')) return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Login diperlukan.' } }), { status: 401 })
    return new Response(JSON.stringify({ data: status, meta: { request_id: 'test' } }))
  }))
})

test('public identity, purpose and policies remain readable while identity verification is stalled', () => {
  const fetch = vi.fn((_url: string) => new Promise<Response>(() => {}))
  vi.stubGlobal('fetch', fetch)
  const client = setup()
  expect(screen.getByRole('heading', { name: 'MySchedule Manager' })).toBeVisible()
  expect(screen.getByText(/Aplikasi agenda dan catatan pribadi/)).toBeVisible()
  expect(screen.getByText(/memakai pengenal akun Google, email terverifikasi/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Memeriksa akses…' })).toBeDisabled()
  expect(screen.getAllByRole('link', { name: 'Ketentuan Layanan' })[0]).toHaveAttribute('href', '/terms/')
  expect(screen.getAllByRole('button', { name: 'Pengaturan cookie' })[0]).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Masuk dengan Google' })).not.toBeInTheDocument()
  expect(screen.queryByText('Tambah agenda')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/me')
  client.clear()
})

test('unavailable login uses public copy without developer diagnostics', async () => {
  const client = setup()
  expect(await screen.findByRole('button', { name: 'Masuk belum tersedia' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Layanan masuk sedang tidak tersedia.')
  expect(screen.queryByText(/Migrasi|API FastAPI|Kesiapan lokal|backend\/\.env|Build 02/)).not.toBeInTheDocument()
  expect(screen.getByText('Contoh tampilan dengan data ilustrasi.')).toBeVisible()
  expect(screen.queryByRole('button', { name: /demo|natural language|bahasa alami/i })).not.toBeInTheDocument()
  client.clear()
})

test('public help explains actual access and Calendar limitations, not local configuration', async () => {
  const client = setup()
  await screen.findByRole('button', { name: 'Masuk belum tersedia' })
  expect(screen.getByText(/Siapa pun bisa masuk dengan akun Google/)).toBeVisible()
  await userEvent.click(screen.getByText('Apakah terhubung ke Google Calendar?'))
  expect(screen.getByText(/Pengingat Google Calendar dan ekspor .ics belum tersedia/)).toBeVisible()
  expect(screen.queryByText(/localhost:5173/)).not.toBeInTheDocument()
  client.clear()
})

test('network errors are not rendered as an empty private calendar', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const client = setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('Koneksi belum berhasil')
  expect(screen.queryByText('0 agenda')).not.toBeInTheDocument()
  client.clear()
})

test('ready service offers public Google sign-in while keeping each account private', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/me')
    ? new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 })
    : new Response(JSON.stringify({ data: { ...status, google_login_configured: true }, meta: { request_id: 'test' } }))))
  const client = setup()
  const login = await screen.findByRole('link', { name: 'Masuk dengan Google' })
  expect(login).toHaveAttribute('href', '/api/v1/auth/google/start?return_to=/')
  expect(screen.getAllByRole('link', { name: 'Masuk dengan Google' })).toHaveLength(1)
  expect(screen.getByText(/Siapa pun bisa masuk dengan akun Google/)).toHaveTextContent('Agenda dan catatan tetap pribadi untuk setiap akun')
  client.clear()
})

test('OAuth errors render fixed public copy rather than echoing the URL', async () => {
  const client = setup('/?error=PRIVATE_INTERNAL_TRACE')
  await screen.findByRole('button', { name: 'Masuk belum tersedia' })
  expect(screen.queryByText(/PRIVATE_INTERNAL_TRACE/)).not.toBeInTheDocument()
  client.clear()
})
