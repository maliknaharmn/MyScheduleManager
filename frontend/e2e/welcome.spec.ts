import { expect, test, type Page } from '@playwright/test'

async function publicService(page: Page) {
  const state = { ready: true, failed: false, gate: undefined as Promise<void> | undefined }
  await page.route('**/api/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/me')) return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'Login diperlukan.' } } })
    await state.gate
    if (state.failed) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'PRIVATE_DATABASE_TRACE' } } })
    return route.fulfill({ json: { data: { phase: 'foundation', database: 'ready', google_login_configured: state.ready, calendar_integration: 'not_implemented', capabilities: { schedules: true, notes: true, calendar_reminders: false }, auth_handshake_storage: 'single_process_memory' }, meta: { request_id: 'public-welcome-test' } } })
  })
  return state
}

test('ready public sign-in has one visible CTA, honest preview and matching light/dark themes', async ({ page }) => {
  await publicService(page)
  await page.goto('/')
  const login = page.getByRole('link', { name: 'Masuk dengan Google' })
  await expect(login).toHaveCount(1)
  await expect(login).toHaveAttribute('href', '/api/v1/auth/google/start?return_to=/')
  await expect(page.getByText(/Siapa pun bisa masuk dengan akun Google/)).toContainText('Agenda dan catatan tetap pribadi untuk setiap akun')
  await expect(page.getByText(/akun.*diizinkan/)).toHaveCount(0)
  const bounds = await login.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(page.viewportSize()!.height)
  expect(await login.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.getByText('Contoh tampilan dengan data ilustrasi.')).toBeVisible()
  await expect(page.locator('.welcome-preview img')).toHaveAttribute('src', '/previews/home-light.png')
  await page.getByRole('switch', { name: 'Mode gelap' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.welcome-preview img')).toHaveAttribute('src', '/previews/home-dark.png')
  await expect(page.getByText(/Kesiapan lokal|Bukan status produksi|backend\/\.env|Build 02/)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('unavailable and failed sign-in show safe retry states and recover without a fake login', async ({ page }) => {
  const state = await publicService(page)
  state.ready = false
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Masuk belum tersedia' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('Layanan masuk sedang tidak tersedia')
  state.ready = true
  state.failed = true
  await page.getByRole('button', { name: 'Coba lagi' }).click()
  await expect(page.getByRole('alert')).toContainText('Koneksi belum berhasil')
  await expect(page.getByText('PRIVATE_DATABASE_TRACE')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toHaveCount(0)
  state.failed = false
  await page.getByRole('button', { name: 'Coba lagi' }).click()
  await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toBeVisible()
})

test('pending service and OAuth failure keep public copy and never echo arbitrary URL details', async ({ page }) => {
  const state = await publicService(page)
  let release!: () => void
  state.gate = new Promise<void>((resolve) => { release = resolve })
  await page.goto('/?error=PRIVATE_OAUTH_TRACE')
  await expect(page.getByRole('button', { name: 'Memeriksa akses…' })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Memeriksa layanan masuk')
  release()
  await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Proses masuk belum selesai')
  await expect(page.getByRole('alert')).not.toContainText('diizinkan')
  await expect(page.getByText('PRIVATE_OAUTH_TRACE')).toHaveCount(0)
  await page.getByText('Bagaimana kapasitas dihitung?').click()
  await expect(page.getByText(/Medium: 6-10 jam/)).toBeVisible()
})
