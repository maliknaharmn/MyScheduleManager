import { expect, test, type Page } from '@playwright/test'

// Synthetic UI-only contract fixtures. Real hashing, RLS, cookies, CSRF and token
// persistence are tested independently against the dedicated PostgreSQL _test DB.
async function nativeService(page: Page, signedIn = false) {
  const state = {
    signedIn, passwordActive: true, owner: true, writeStatus: 204,
    verification: undefined as Promise<void> | undefined,
    writes: [] as { path: string; body: Record<string, string>; csrf: string | undefined }[],
  }
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/me')) {
      if (state.signedIn) await state.verification
      return state.signedIn ? route.fulfill({ json: { data: {
        user: { id: 'native-ui-owner', email: 'owner@example.invalid', display_name: 'Account owner' },
        profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 },
        csrf_token: 'synthetic-session-csrf', calendar: { connection_status: 'not_implemented' },
      } } }) : route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } })
    }
    if (path.endsWith('/status')) return route.fulfill({ json: { data: {
      phase: 'foundation', database: 'ready', google_login_configured: true,
      calendar_integration: 'not_implemented', capabilities: { schedules: true, notes: true, calendar_reminders: false }, auth_handshake_storage: 'single_process_memory',
    } } })
    if (path.endsWith('/password/context')) return route.fulfill({ json: { data: { enabled: true, registration_open: false, csrf_token: 'synthetic-form-csrf' } } })
    if (path.endsWith('/password/security')) return route.fulfill({ json: { data: { enabled: state.owner, password_active: state.passwordActive, username: 'malik', email: 'owner@example.invalid' } } })
    if (request.method() === 'POST' && path.includes('/auth/password/')) {
      state.writes.push({ path, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
      if (state.writeStatus !== 204) return route.fulfill({ status: state.writeStatus, json: { error: { code: state.writeStatus === 400 ? 'PASSWORD_LINK_INVALID' : 'PASSWORD_LOGIN_FAILED', message: 'PRIVATE_SERVER_TRACE' } } })
      if (path.endsWith('/login')) state.signedIn = true
      if (path.endsWith('/change') || path.endsWith('/reset') || path.endsWith('/activate')) state.signedIn = false
      if (path.endsWith('/forgot') || path.endsWith('/invitation')) return route.fulfill({ status: 202, json: { data: { message: 'Jika akun memenuhi syarat, tautan akan dikirim. Periksa inbox dan spam.' } } })
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } })
  })
  return state
}

test('native login sends one CSRF-bound request and waits for server-confirmed identity', async ({ page }) => {
  const state = await nativeService(page)
  let release!: () => void
  state.verification = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled()
    await page.getByLabel('Username atau email').fill('MALIK')
    await page.getByLabel('Password', { exact: true }).fill('Orbit482!')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Memproses…', exact: true })).toBeDisabled()
    await expect(page.locator('.app-shell')).toHaveCount(0)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].csrf).toBe('synthetic-form-csrf')
    release()
    await expect(page.locator('.app-shell')).toBeVisible()
    expect(state.writes).toHaveLength(1)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('Orbit482!'))).toBe(false)
  } finally { release() }
})

test('activation and reset capture fragments in memory, do not use links on GET, and require explicit POST', async ({ page }) => {
  const state = await nativeService(page)
  const token = 'r'.repeat(43)
  for (const [route, endpoint] of [['activate-password', 'activate'], ['reset-password', 'reset']]) {
    state.writes.length = 0
    await page.goto(`/${route}#token=${token}`)
    await expect(page).toHaveURL(new RegExp(`/${route}$`))
    expect(state.writes).toHaveLength(0)
    await expect(page.getByLabel('Password baru', { exact: true })).toBeVisible()
    await page.getByLabel('Password baru', { exact: true }).fill('Orbit482!')
    await page.getByLabel('Konfirmasi password', { exact: true }).fill('Orbit482!')
    await page.getByRole('button', { name: endpoint === 'activate' ? 'Aktifkan password' : 'Simpan password baru', exact: true }).click()
    await expect(page.getByText('Password berhasil disimpan. Semua sesi aplikasi sebelumnya diakhiri. Silakan masuk kembali.')).toBeVisible()
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].path).toBe(`/api/v1/auth/password/${endpoint}`)
    expect(state.writes[0].body.token).toBe(token)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage, cookie: document.cookie }).includes('r'.repeat(43)))).toBe(false)
    await expect(page.locator('.app-shell')).toHaveCount(0)
  }
})

test('invalid links retain drafts and never echo tokens, internal errors or fake success', async ({ page }) => {
  const state = await nativeService(page)
  state.writeStatus = 400
  await page.goto(`/reset-password#token=${'s'.repeat(43)}`)
  await page.getByLabel('Password baru', { exact: true }).fill('Orbit482!')
  await page.getByLabel('Konfirmasi password', { exact: true }).fill('Orbit482!')
  await page.getByRole('button', { name: 'Simpan password baru', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Tautan tidak valid atau kedaluwarsa. Minta tautan baru.')
  await expect(page.getByLabel('Password baru', { exact: true })).toHaveValue('Orbit482!')
  await expect(page.getByText(/PRIVATE_SERVER_TRACE|Password berhasil disimpan/)).toHaveCount(0)
  expect(state.writes).toHaveLength(1)
})

test('forgot and invitation show only server-confirmed conditional delivery copy', async ({ page }) => {
  const state = await nativeService(page)
  for (const route of ['forgot-password', 'activate-password']) {
    await page.goto(`/${route}`)
    const button = page.getByRole('button', { name: route === 'forgot-password' ? 'Kirim tautan reset' : 'Kirim undangan', exact: true })
    await expect(button).toBeEnabled()
    await page.getByLabel('Email', { exact: true }).fill('owner@example.invalid')
    await button.click()
    await expect(page.getByText('Jika akun memenuhi syarat, tautan akan dikirim. Periksa inbox dan spam.')).toBeVisible()
    await expect(page.getByText(/Email berhasil dikirim|Akun berhasil dibuat/)).toHaveCount(0)
  }
  expect(state.writes).toHaveLength(2)
})

test('password changes require an active password account and use the authenticated CSRF token', async ({ page }) => {
  const state = await nativeService(page, true)
  state.passwordActive = false
  await page.goto('/settings/security')
  await expect(page.getByText(/Password akun ini belum diaktifkan/)).toBeVisible()
  await expect(page.getByLabel('Password saat ini', { exact: true })).toHaveCount(0)
  state.owner = false
  await page.reload()
  await expect(page.getByText(/Akses password belum tersedia untuk akun ini/)).toBeVisible()
  state.owner = true
  state.passwordActive = true
  await page.reload()
  await expect(page.getByRole('button', { name: 'Simpan password baru', exact: true })).toBeEnabled()
  await page.getByLabel('Password saat ini', { exact: true }).fill('Orbit482!')
  await page.getByLabel('Password baru', { exact: true }).fill('River793!')
  await page.getByLabel('Konfirmasi password', { exact: true }).fill('River793!')
  await page.getByRole('button', { name: 'Simpan password baru', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Masuk ke MySchedule' })).toBeVisible()
  await expect(page.getByText(/Password berhasil disimpan/)).toBeVisible()
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0].csrf).toBe('synthetic-session-csrf')
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
})

test('native readiness does not open general signup, even when submission is forced', async ({ page }) => {
  const state = await nativeService(page)
  await page.goto('/signup')
  await expect(page.getByText(/Aktivasi password masih melalui undangan/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Buat akun', exact: true })).toBeDisabled()
  await page.locator('.access-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(state.writes).toHaveLength(0)
})
