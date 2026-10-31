import { expect, test, type Page } from '@playwright/test'

async function publicService(page: Page) {
  const state = { ready: true, failed: false, gate: undefined as Promise<void> | undefined, sessionGate: undefined as Promise<void> | undefined }
  await page.route('**/api/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/me')) {
      await state.sessionGate
      return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'Login diperlukan.' } } })
    }
    await state.gate
    if (state.failed) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'PRIVATE_DATABASE_TRACE' } } })
    return route.fulfill({ json: { data: { phase: 'foundation', database: 'ready', google_login_configured: state.ready, calendar_integration: 'not_implemented', capabilities: { schedules: true, notes: true, calendar_reminders: false }, auth_handshake_storage: 'single_process_memory' }, meta: { request_id: 'public-welcome-test' } } })
  })
  return state
}

test('ready public sign-in has one visible CTA, honest preview and matching light/dark themes', async ({ page }) => {
  await publicService(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'MySchedule Manager', exact: true })).toBeVisible()
  await expect(page.locator('.welcome-public-header .brand-suffix')).toBeVisible()
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

test('homepage remains useful without JavaScript, a session or any API requests', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: test.info().project.use.viewport })
  try {
    const page = await context.newPage()
    const apiRequests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
    await page.route('**/api/v1/**', route => route.abort())
    await page.goto(`${baseURL}/`)
    await expect(page.getByRole('heading', { name: 'MySchedule Manager', exact: true })).toBeVisible()
    await expect(page.getByText(/Aplikasi agenda dan catatan pribadi/)).toBeVisible()
    await expect(page.getByText(/memakai pengenal akun Google, email terverifikasi/)).toBeVisible()
    await expect(page.getByText(/Aplikasi hanya meminta izin identitas/)).toBeVisible()
    await expect(page.getByText(/Aktifkan JavaScript untuk masuk/)).toBeVisible()
    await expect(page.getByText('Contoh tampilan dengan data ilustrasi.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'maliknahar.mn@gmail.com', exact: true })).toHaveAttribute('href', 'mailto:maliknahar.mn@gmail.com')
    await page.getByText('Apakah terhubung ke Google Calendar?').click()
    await expect(page.getByText(/Pengingat Google Calendar dan ekspor .ics belum tersedia/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    expect(apiRequests).toEqual([])
    await page.getByRole('navigation', { name: 'Kebijakan layanan' }).getByRole('link', { name: 'Kebijakan Privasi', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Kebijakan Privasi', exact: true })).toBeVisible()
  } finally { await context.close() }
})

test('blocked application bundles leave the static homepage readable', async ({ page }) => {
  await page.route('**/assets/*.js', route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'MySchedule Manager', exact: true })).toBeVisible()
  await expect(page.getByText(/Aplikasi agenda dan catatan pribadi/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Google hanya untuk masuk' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pengaturan cookie' })).toHaveAttribute('href', '/cookies/#pilihan')
})

test('stalled session verification keeps public content and cookie controls but no private workspace', async ({ page }) => {
  const state = await publicService(page)
  let release!: () => void
  state.sessionGate = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'MySchedule Manager', exact: true })).toBeVisible()
    await expect(page.getByText(/Aplikasi agenda dan catatan pribadi/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Memeriksa akses…' })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toHaveCount(0)
    await expect(page.getByText('Tambah agenda', { exact: true })).toHaveCount(0)
    await page.getByRole('navigation', { name: 'Kebijakan layanan' }).getByRole('button', { name: 'Pengaturan cookie' }).click()
    await expect(page.getByRole('dialog', { name: 'Pengaturan cookie' })).toBeVisible()
    await page.keyboard.press('Escape')
    release()
    await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toBeVisible()
  } finally { release() }
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
