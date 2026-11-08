import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from './App'

const publicStatus = { phase: 'foundation', database: 'ready', google_login_configured: true,
  calendar_integration: 'not_implemented', capabilities: { schedules: true, notes: true, calendar_reminders: false }, auth_handshake_storage: 'single_process_memory' }
const me = { user: { id: 'local-test-owner', email: 'owner@example.invalid', display_name: 'Account owner' }, profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 }, csrf_token: 'test-only', calendar: { connection_status: 'not_implemented' } }
let signedIn = false

function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>)
  return client
}

beforeEach(() => {
  signedIn = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/me')) return signedIn
      ? new Response(JSON.stringify({ data: me }))
      : new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 })
    return new Response(JSON.stringify({ data: publicStatus }))
  }))
})

test('signup has the requested fields in order, one real Google action, and honest disabled submission', async () => {
  const client = setup('/signup')
  await screen.findByRole('heading', { name: 'Buat akun baru' })
  expect([...document.querySelectorAll('.access-form input')].map(input => input.id)).toEqual(['username', 'email', 'password', 'confirm-password'])
  expect(screen.getByLabelText('Email untuk verifikasi')).toHaveAttribute('type', 'email')
  expect(screen.getByRole('button', { name: 'Buat akun' })).toBeDisabled()
  expect(await screen.findByRole('link', { name: 'Daftar dengan Google' })).toHaveAttribute('href', '/api/v1/auth/google/start?return_to=/')
  expect(screen.getByText(/Pendaftaran email belum dibuka/)).toBeVisible()
  expect(screen.queryByText(/Akun berhasil|Email terkirim/)).not.toBeInTheDocument()
  client.clear()
})

test('password and confirmation reveal independently, hide on leaving the tab, and validate matching', async () => {
  const client = setup('/signup')
  await screen.findByRole('heading', { name: 'Buat akun baru' })
  const password = screen.getByLabelText('Password', { exact: true })
  const confirmation = screen.getByLabelText('Konfirmasi password')
  await userEvent.type(password, 'Orbit482')
  expect(within(screen.getByRole('list', { name: 'Persyaratan password' })).getAllByText(/: terpenuhi/)).toHaveLength(3)
  await userEvent.click(screen.getByRole('button', { name: 'Lihat password' }))
  expect(password).toHaveAttribute('type', 'text')
  expect(confirmation).toHaveAttribute('type', 'password')
  await userEvent.type(confirmation, 'different')
  fireEvent.blur(confirmation)
  expect(screen.getByRole('alert')).toHaveTextContent('Konfirmasi password belum sama.')
  await userEvent.clear(confirmation)
  await userEvent.type(confirmation, 'Orbit482')
  expect(screen.queryByText('Konfirmasi password belum sama.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Buat akun' })).toBeDisabled()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  await waitFor(() => expect(password).toHaveAttribute('type', 'password'))
  visibility.mockRestore()
  client.clear()
})

test('navigation discards credentials and the UI never posts, caches, or logs them', async () => {
  const client = setup('/signup')
  await screen.findByRole('heading', { name: 'Buat akun baru' })
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'Orbit482')
  fireEvent.submit(document.querySelector('.access-form')!)
  expect(screen.queryByText(/Akun berhasil dibuat/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'Masuk' }))
  await screen.findByRole('heading', { name: 'Masuk ke MySchedule' })
  expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('')
  const fetch = vi.mocked(globalThis.fetch)
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain('Orbit482')
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('Orbit482')
  client.clear()
})

test.each([
  ['/forgot-password', 'Lupa password?', 'Kirim tautan reset'],
  ['/activate-password', 'Aktifkan password akun', 'Aktifkan password'],
  ['/reset-password', 'Atur password baru', 'Simpan password baru'],
])('recovery and activation pages never claim a token is valid or an email was sent', async (path, title, action) => {
  const client = setup(`${path}?error=PRIVATE_TRACE#untrusted-token`)
  await screen.findByRole('heading', { name: title })
  expect(screen.getByRole('button', { name: action })).toBeDisabled()
  expect(document.body).not.toHaveTextContent('PRIVATE_TRACE')
  expect(document.body).not.toHaveTextContent('untrusted-token')
  expect(screen.queryByText(/Verifikasi berhasil|Email berhasil dikirim/)).not.toBeInTheDocument()
  client.clear()
})

test('password settings require verified identity and show no editable fields anonymously', async () => {
  const client = setup('/settings/security')
  expect(await screen.findByRole('heading', { name: 'Masuk terlebih dahulu' })).toBeVisible()
  expect(screen.queryByLabelText('Password saat ini')).not.toBeInTheDocument()
  client.clear()
})

test('an authenticated user can review change password without changing Google credentials', async () => {
  signedIn = true
  const client = setup('/settings/security')
  await screen.findByRole('heading', { name: 'Ganti password' })
  expect(screen.getByLabelText('Password saat ini')).toHaveAttribute('autocomplete', 'current-password')
  expect(screen.getByLabelText('Password baru')).toHaveAttribute('autocomplete', 'new-password')
  expect(screen.getByRole('button', { name: 'Simpan password baru' })).toBeDisabled()
  expect(screen.getByText(/tidak mengubah password Google/)).toBeVisible()
  client.clear()
})
