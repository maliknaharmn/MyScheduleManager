import { expect, test } from '@playwright/test'

test('private foundation loads with no mock login and no mobile overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Jadwal jelas/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Login menunggu konfigurasi' })).toBeDisabled()
  await expect(page.getByText('Migrasi terpasang, role API terbatas.')).toBeVisible()
  await page.getByRole('button', { name: /Lihat panduan konfigurasi/ }).click()
  await expect(page.getByText('Konfigurasi disimpan di backend/.env')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  expect(errors).toEqual([])
  await page.screenshot({ path: `test-results/foundation-${test.info().project.name}.png`, fullPage: true })
})

test('real unauthenticated API requests cannot access private data', async ({ request }) => {
  const response = await request.get('/api/v1/me')
  expect(response.status()).toBe(401)
  expect((await response.json()).error.code).toBe('AUTH_REQUIRED')
  const login = await request.get('/api/v1/auth/google/start')
  expect(login.status()).toBe(503)
  expect((await login.json()).error.code).toBe('GOOGLE_NOT_CONFIGURED')
})
