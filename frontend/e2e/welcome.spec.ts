import { expect, test, type Page } from '@playwright/test'

async function publicService(page: Page) {
  const state = { ready: true, failed: false, gate: undefined as Promise<void> | undefined, sessionGate: undefined as Promise<void> | undefined, writes: [] as string[] }
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() !== 'GET') state.writes.push(new URL(route.request().url()).pathname)
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

test('ready public sign-in has one visible Google CTA, illustrative previews and matching light/dark themes', async ({ page }) => {
  await publicService(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Hari yang\s*lebih ringan\./ })).toBeVisible()
  await expect(page.locator('.welcome-public-header .brand-mark img')).toBeVisible()
  const account = page.getByRole('navigation', { name: 'Akses akun' })
  await expect(account.getByRole('link', { name: 'Masuk', exact: true })).toHaveAttribute('href', '/login')
  await expect(account.getByRole('link', { name: 'Buat akun', exact: true })).toHaveAttribute('href', '/signup')
  const login = page.getByRole('link', { name: 'Masuk dengan Google' })
  await expect(login).toHaveCount(1)
  await expect(login).toHaveAttribute('href', '/api/v1/auth/google/start?return_to=/')
  await expect(page.getByText(/Siapa pun bisa masuk dengan akun Google/)).toContainText('Agenda dan catatan tetap pribadi untuk setiap akun')
  await expect(page.getByText(/akun.*diizinkan/)).toHaveCount(0)
  const bounds = await login.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(page.viewportSize()!.height)
  expect(await login.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Kalender hidup' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'November 2026', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Agenda Mingguan' })).toBeVisible()
  await expect(page.getByText('Coba jelajahi satu minggu')).toBeVisible()
  await expect(page.getByText('Data ilustrasi').first()).toBeVisible()
  await page.getByRole('switch', { name: 'Mode gelap' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('heading', { name: 'Kalender hidup' })).toBeVisible()
  await expect(page.getByText(/Kesiapan lokal|Bukan status produksi|backend\/\.env|Build 02/)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('choosing a calendar date updates the linked public illustration without private writes', async ({ page }) => {
  const state = await publicService(page)
  await page.goto('/')
  const calendar = page.locator('.welcome-hero')
  const detail = page.locator('#welcome-month-detail')
  await expect(detail).toContainText('6 jam')
  const initialDetail = await detail.innerText()
  const date = calendar.getByRole('button', { name: 'Rabu, 18 November 2026' })
  await date.click()
  await expect(date).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => detail.innerText()).not.toBe(initialDetail)
  await expect(detail).toContainText('Rabu, 18 November 2026')
  await expect(detail).toContainText('8 jam')
  await expect(detail).toContainText('Diskusi klien')
  await expect(detail).toContainText('Rencana rapat')
  const progress = detail.getByRole('progressbar', { name: 'Progres checklist contoh' })
  await expect(progress).toHaveAttribute('aria-valuenow', '2')
  await detail.getByRole('checkbox', { name: 'Kirim ringkasan' }).check()
  await expect(progress).toHaveAttribute('aria-valuenow', '3')
  await calendar.getByRole('button', { name: 'Kamis, 19 November 2026' }).click()
  await expect(detail).toContainText('Belum ada catatan penting pada contoh tanggal ini.')
  await date.click()
  await expect(progress).toHaveAttribute('aria-valuenow', '3')
  await page.reload()
  await date.click()
  await expect(progress).toHaveAttribute('aria-valuenow', '2')
  expect(state.writes).toEqual([])
})

test('weekly preview responds to keyboard navigation and updates its agenda', async ({ page }) => {
  const state = await publicService(page)
  await page.goto('/')
  const weekly = page.getByRole('heading', { name: 'Agenda Mingguan' }).locator('xpath=ancestor::section[1]')
  const detail = weekly.locator('#welcome-week-detail')
  const initialDetail = await detail.innerText()
  const tabs = weekly.getByRole('tab')
  await expect(tabs).toHaveCount(7)
  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.nth(1)).toBeFocused()
  await expect.poll(() => detail.innerText()).not.toBe(initialDetail)
  await expect(detail).toContainText('Selasa, 17 November 2026')
  await expect(detail).toContainText('3 jam')
  await expect(detail).toContainText('Tinjau dokumen')
  await page.keyboard.press('End')
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  expect(state.writes).toEqual([])
})

test('Masuk and Buat akun remain available when Google is unavailable or failing', async ({ page }) => {
  const state = await publicService(page)
  for (const failed of [false, true]) {
    state.ready = false
    state.failed = failed
    await page.goto('/')
    const account = page.getByRole('navigation', { name: 'Akses akun' })
    await expect(account.getByRole('link', { name: 'Masuk', exact: true })).toBeVisible()
    await expect(account.getByRole('link', { name: 'Buat akun', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toHaveCount(0)
  }
  expect(state.writes).toEqual([])
})

test('new Welcome retains visible account actions and readable previews at every viewport in both themes', async ({ page }) => {
  await publicService(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  const widths = test.info().project.name === 'desktop' ? [1440, 768] : [390, 320]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toBeVisible()
    await page.getByRole('button', { name: 'Tutup pemberitahuan cookie' }).click()
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click()
      const account = page.getByRole('navigation', { name: 'Akses akun' })
      for (const label of ['Masuk', 'Buat akun']) {
        const link = account.getByRole('link', { name: label, exact: true })
        await expect(link).toBeInViewport()
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await expect(page.locator('.app-shell')).toHaveCount(0)
      await page.screenshot({ path: `test-results/welcome-${theme}-${width}.png`, fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('homepage remains useful without JavaScript, a session or any API requests', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: test.info().project.use.viewport })
  try {
    const page = await context.newPage()
    const apiRequests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
    await page.route('**/api/v1/**', route => route.abort())
    await page.goto(`${baseURL}/`)
    await expect(page.getByRole('heading', { name: /Hari yang\s*lebih ringan\./ })).toBeVisible()
    await expect(page.getByText(/Aplikasi agenda dan catatan pribadi/)).toBeVisible()
    await expect(page.getByText(/memakai pengenal akun Google, email terverifikasi/)).toBeVisible()
    await expect(page.getByText(/Aplikasi hanya meminta izin identitas/)).toBeVisible()
    await expect(page.getByText(/Aktifkan JavaScript untuk masuk/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kalender hidup' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Agenda Mingguan' })).toBeVisible()
    await expect(page.getByText('Data ilustrasi').first()).toBeVisible()
    await expect(page.locator('.welcome-hero').getByRole('button', { name: /November 2026/ })).toHaveCount(30)
    await expect(page.getByRole('tab')).toHaveCount(7)
    await expect(page.getByRole('navigation', { name: 'Akses akun' }).getByRole('link', { name: 'Masuk', exact: true })).toHaveAttribute('href', '/login')
    await expect(page.getByRole('navigation', { name: 'Akses akun' }).getByRole('link', { name: 'Buat akun', exact: true })).toHaveAttribute('href', '/signup')
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
  await expect(page.getByRole('heading', { name: /Hari yang\s*lebih ringan\./ })).toBeVisible()
  await expect(page.getByText(/Aplikasi agenda dan catatan pribadi/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kalender hidup' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Agenda Mingguan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Google hanya untuk masuk' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pengaturan cookie' })).toHaveAttribute('href', '/cookies/#pilihan')
})

test('stalled session verification keeps public content and cookie controls but no private workspace', async ({ page }) => {
  const state = await publicService(page)
  let release!: () => void
  state.sessionGate = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Hari yang\s*lebih ringan\./ })).toBeVisible()
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
