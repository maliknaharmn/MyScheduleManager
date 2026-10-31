import { expect, test } from '@playwright/test'

test('public Welcome hides development diagnostics and has no mobile overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'MySchedule Manager', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Masuk belum tersedia' })).toBeDisabled()
  await expect(page.getByText(/Siapa pun bisa masuk dengan akun Google/)).toBeVisible()
  await expect(page.getByText(/Kesiapan lokal|API FastAPI|Migrasi terpasang|backend\/\.env|Build 02/)).toHaveCount(0)
  await page.getByText('Apakah terhubung ke Google Calendar?').click()
  await expect(page.getByText(/Pengingat Google Calendar dan ekspor .ics belum tersedia/)).toBeVisible()
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
