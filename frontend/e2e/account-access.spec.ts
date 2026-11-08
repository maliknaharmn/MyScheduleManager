import { expect, test, type Page } from '@playwright/test'

// Synthetic read responses only. Native auth is intentionally not implemented
// before owner review, so even these fixtures never manufacture a successful signup.
async function accountService(page: Page, signedIn = false) {
  const state = { failed: false, ready: true, signedIn, gate: undefined as Promise<void> | undefined, writes: [] as string[] }
  await page.context().route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') state.writes.push(path)
    if (path.endsWith('/me')) {
      await state.gate
      return state.signedIn ? route.fulfill({ json: { data: {
        user: { id: 'account-ui-test', email: 'owner@example.invalid', display_name: 'Account owner' },
        profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 },
        csrf_token: 'synthetic-only', calendar: { connection_status: 'not_implemented' },
      } } }) : route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } })
    }
    if (path.endsWith('/status')) return state.failed
      ? route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'PRIVATE_TRACE' } } })
      : route.fulfill({ json: { data: { phase: 'foundation', database: 'ready', google_login_configured: state.ready, calendar_integration: 'not_implemented', capabilities: { schedules: true, notes: true, calendar_reminders: false }, auth_handshake_storage: 'single_process_memory' } } })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } })
  })
  return state
}

test('public homepage opens login/signup and preserves the real Google entrypoint', async ({ page }) => {
  await accountService(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Akses akun' }).getByRole('link', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Masuk ke MySchedule' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Masuk dengan Google', exact: true })).toHaveAttribute('href', '/api/v1/auth/google/start?return_to=/')
  await expect(page.getByLabel('Username atau email')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeDisabled()
  await page.getByRole('link', { name: 'Buat akun', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Buat akun baru' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Daftar dengan Google' })).toHaveCount(1)
  expect(await page.locator('.access-form input').evaluateAll(inputs => inputs.map(input => input.id))).toEqual(['username', 'email', 'password', 'confirm-password'])
})

test('password feedback, independent reveal controls and keyboard focus work without auth writes', async ({ page }) => {
  const state = await accountService(page)
  await page.goto('/signup')
  const password = page.getByLabel('Password', { exact: true })
  const confirm = page.getByLabel('Konfirmasi password', { exact: true })
  await password.fill('lower123')
  await confirm.focus()
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await password.fill('Orbit482')
  await confirm.focus()
  await expect(page.locator('.access-rules [data-met=true]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Lihat password', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toBeFocused()
  await expect(confirm).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Lihat konfirmasi password' }).click()
  await expect(confirm).toHaveAttribute('type', 'text')
  await confirm.fill('different')
  await password.focus()
  await expect(page.getByRole('alert')).toContainText('Konfirmasi password belum sama.')
  await confirm.fill('Orbit482')
  await expect(page.getByText('Konfirmasi password belum sama.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sembunyikan konfirmasi password' }).click()
  await expect(confirm).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Buat akun', exact: true })).toBeDisabled()
  expect(state.writes).toEqual([])
})

test('signup never sends credentials, persists them, or claims mail/account success before backend review', async ({ page }) => {
  const state = await accountService(page)
  await page.goto('/signup')
  await page.getByLabel('Username', { exact: true }).fill('account.owner')
  await page.getByLabel('Email untuk verifikasi').fill('owner@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('Orbit482')
  await page.getByLabel('Konfirmasi password', { exact: true }).fill('Orbit482')
  await page.locator('.access-form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })))
  await expect(page.getByText(/Pendaftaran email belum dibuka/).first()).toBeVisible()
  expect(state.writes).toEqual([])
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }).includes('Orbit482'))).toBe(false)
  await expect(page.getByText(/Akun berhasil dibuat|Email berhasil dikirim/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Masuk', exact: true }).click()
  await page.getByRole('link', { name: 'Buat akun', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Konfirmasi password', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Email untuk verifikasi')).toHaveValue('')
})

test('recovery, activation and reset remain truthful and do not echo arbitrary token/error data', async ({ page }) => {
  const state = await accountService(page)
  for (const [path, title, action] of [
    ['/forgot-password', 'Lupa password?', 'Kirim tautan reset'],
    ['/activate-password', 'Aktifkan password akun', 'Aktifkan password'],
    ['/reset-password', 'Atur password baru', 'Simpan password baru'],
  ]) {
    await page.goto(`${path}?error=PRIVATE_TRACE#untrusted-token`)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled()
    await expect(page.getByText(/PRIVATE_TRACE|untrusted-token/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Kembali ke halaman masuk' })).toHaveAttribute('href', '/login')
  }
  expect(state.writes).toEqual([])
})

test('Google readiness retries safely and OAuth errors never expose internal details', async ({ page }) => {
  const state = await accountService(page)
  state.failed = true
  await page.goto('/login?error=PRIVATE_TRACE')
  await expect(page.getByText('Koneksi belum berhasil. Coba lagi untuk masuk dengan Google.')).toBeVisible()
  await expect(page.getByText('PRIVATE_TRACE')).toHaveCount(0)
  await expect(page.getByText('Proses masuk Google belum selesai. Silakan mulai kembali.')).toBeVisible()
  state.failed = false
  await page.getByRole('button', { name: 'Coba lagi' }).click()
  await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeDisabled()
})

test('change password waits for session verification and refuses anonymous access', async ({ page }) => {
  const state = await accountService(page)
  let release!: () => void
  state.gate = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/settings/security')
    await expect(page.getByRole('heading', { name: 'Memeriksa sesi' })).toBeVisible()
    await expect(page.getByLabel('Password saat ini', { exact: true })).toHaveCount(0)
    release()
    await expect(page.getByRole('heading', { name: 'Masuk terlebih dahulu' })).toBeVisible()
    await expect(page.getByLabel('Password saat ini', { exact: true })).toHaveCount(0)
  } finally { release() }
})

test('a verified session can review password settings without changing any credential', async ({ page }) => {
  const state = await accountService(page, true)
  await page.goto('/settings/security')
  await expect(page.getByRole('heading', { name: 'Ganti password', exact: true })).toBeVisible()
  await expect(page.getByLabel('Password saat ini', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  await expect(page.getByLabel('Password baru', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
  await expect(page.getByRole('button', { name: 'Simpan password baru' })).toBeDisabled()
  await expect(page.getByText(/tidak mengubah password Google/)).toBeVisible()
  expect(state.writes).toEqual([])
})

test('public release forms fit desktop/tablet/phone in both themes with cookie controls', async ({ page }) => {
  await accountService(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const widths = test.info().project.name === 'desktop' ? [1440, 768] : [390, 320]
  for (const path of ['login', 'signup']) {
    await page.goto(`/${path}`)
    await expect(page.getByRole('heading', { name: path === 'signup' ? 'Buat akun baru' : 'Masuk ke MySchedule' })).toBeVisible()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 })
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click()
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        await expect(page.getByRole('button', { name: 'Tutup pemberitahuan cookie' })).toBeVisible()
        await page.screenshot({ path: `test-results/account-${path}-${theme}-${width}.png`, fullPage: true })
      }
    }
    const settings = page.locator('.access-footer').getByRole('button', { name: 'Pengaturan cookie' })
    await settings.scrollIntoViewIfNeeded()
    await settings.click()
    await expect(page.getByRole('dialog', { name: 'Pengaturan cookie' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})
