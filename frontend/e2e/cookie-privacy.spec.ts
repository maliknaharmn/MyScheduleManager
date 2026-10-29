import { expect, test, type Page } from '@playwright/test'

async function publicService(page: Page) {
  await page.route('**/api/v1/**', route => new URL(route.request().url()).pathname.endsWith('/me')
    ? route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } })
    : route.fulfill({ json: { data: { database: 'ready', google_login_configured: true } } }))
}
async function optionalCookies(page: Page) { return (await page.context().cookies()).filter(cookie => cookie.name === 'myschedule_theme') }

test('optional storage is off before consent, and rejecting it does not block real login', async ({ page }) => {
  await publicService(page)
  await page.goto('/')
  const notice = page.getByRole('region', { name: 'Pilihan penyimpananmu' })
  await expect(notice).toBeVisible()
  await page.getByRole('switch', { name: 'Mode gelap' }).click()
  expect(await optionalCookies(page)).toEqual([])
  await notice.getByRole('button', { name: 'Hanya yang wajib' }).click()
  await expect(notice).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toHaveAttribute('href', '/api/v1/auth/google/start?return_to=/')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'myschedule-week-cache-v1'))).toBe(false)
})

test('settings are opt-in, reversible, keyboard accessible and synced across tabs', async ({ page }) => {
  await publicService(page)
  await page.goto('/')
  const notice = page.getByRole('region', { name: 'Pilihan penyimpananmu' })
  await notice.getByRole('button', { name: 'Pengaturan cookie' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pengaturan cookie' })
  await expect(dialog.getByRole('checkbox', { name: /Cookie wajib/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /Cookie wajib/ })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: 'Ingat tema tampilan' })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Simpan agenda di perangkat' })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(notice.getByRole('button', { name: 'Pengaturan cookie' })).toBeFocused()
  await notice.getByRole('button', { name: 'Izinkan opsional' }).click()
  await page.getByRole('switch', { name: 'Mode gelap' }).click()
  await expect.poll(() => optionalCookies(page)).not.toEqual([])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // Seed an existing optional cache to prove withdrawal cleans disk, not just UI state.
  await page.evaluate(() => new Promise<void>(resolve => {
    const request = indexedDB.open('myschedule-week-cache-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('weeks')
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('weeks', 'readwrite'); tx.objectStore('weeks').put('private agenda', 'test'); tx.oncomplete = () => { db.close(); resolve() } }
  }))
  const other = await page.context().newPage()
  await publicService(other)
  await other.goto('/')
  await page.getByRole('button', { name: 'Pengaturan cookie' }).click()
  await dialog.getByRole('button', { name: 'Hanya yang wajib' }).click()
  await expect.poll(() => optionalCookies(page)).toEqual([])
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'myschedule-week-cache-v1'))).toBe(false)
  await other.getByRole('button', { name: 'Pengaturan cookie' }).click()
  await expect(other.getByRole('checkbox', { name: 'Ingat tema tampilan' })).not.toBeChecked()
  await expect(other.getByRole('checkbox', { name: 'Simpan agenda di perangkat' })).not.toBeChecked()
  await other.close()
})

test('a blocked cookie store reports failure rather than pretending consent was saved', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => {} }))
  await publicService(page)
  await page.goto('/')
  await page.getByRole('region', { name: 'Pilihan penyimpananmu' }).getByRole('button', { name: 'Izinkan opsional' }).click()
  await expect(page.getByRole('alert')).toContainText('Pilihan tidak dapat disimpan')
  await expect(page.getByRole('region', { name: 'Pilihan penyimpananmu' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Masuk dengan Google' })).toBeVisible()
  expect(await optionalCookies(page)).toEqual([])
})
