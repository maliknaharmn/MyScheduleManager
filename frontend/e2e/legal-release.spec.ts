import { expect, test } from '@playwright/test'

const policies = [
  { path: '/privacy/', title: 'Kebijakan Privasi', anchor: 'hak' },
  { path: '/terms/', title: 'Ketentuan Layanan', anchor: 'batas' },
  { path: '/cookies/', title: 'Kebijakan Cookie', anchor: 'pilihan' },
]

for (const policy of policies) {
  test(`${policy.title} is readable without JavaScript, a session or a working API`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: test.info().project.use.viewport })
    const page = await context.newPage()
    const apiRequests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
    await page.route('**/api/v1/**', route => route.abort())
    await page.goto(`${baseURL}${policy.path}`)
    await expect(page.getByRole('heading', { name: policy.title, exact: true })).toBeVisible()
    await expect(page.getByText('Berlaku mulai')).toBeVisible()
    await expect(page.getByText('Pengelola: MySchedule Manager')).toBeVisible()
    await expect(page.locator('article')).not.toContainText(/Draf|belum ditetapkan|sebelum publikasi/)
    await expect(page.getByRole('link', { name: 'maliknahar.mn@gmail.com', exact: true }).last()).toHaveAttribute('href', 'mailto:maliknahar.mn@gmail.com')
    const index = page.getByRole('complementary')
    await index.locator(`a[href="#${policy.anchor}"]`).click()
    await expect(page).toHaveURL(new RegExp(`#${policy.anchor}$`))
    await expect(page.locator(`#${policy.anchor} h2`)).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    expect(apiRequests).toEqual([])
    await context.close()
  })
}

test('static legal settings use the same reversible browser choice as Welcome without calling the API', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
  await page.route('**/api/v1/**', route => route.abort())
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/cookies/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.locator('.cookie-settings-inline').getByRole('button', { name: 'Pengaturan cookie' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pengaturan cookie' })
  await expect(dialog.getByRole('checkbox', { name: 'Ingat tema tampilan' })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Simpan agenda di perangkat' })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Ingat tema tampilan' }).check()
  await dialog.getByRole('button', { name: 'Simpan pilihan' }).click()
  await page.goto('/privacy/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Pengaturan cookie' }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Ingat tema tampilan' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Simpan agenda di perangkat' })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Pengaturan cookie' })).toBeFocused()
  await page.getByRole('button', { name: 'Pengaturan cookie' }).click()
  await dialog.getByRole('button', { name: 'Hanya yang wajib' }).click()
  const choice = (await page.context().cookies()).find(cookie => cookie.name === 'myschedule_storage')
  expect(JSON.parse(decodeURIComponent(choice!.value))).toMatchObject({ preferences: false, agendaCache: false })
  expect((await page.context().cookies()).some(cookie => cookie.name === 'myschedule_theme')).toBe(false)
  expect(apiRequests).toEqual([])
})

test('Welcome links to all published policies even when login is unavailable', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }))
  await page.goto('/')
  const links = page.getByRole('navigation', { name: 'Kebijakan layanan' })
  for (const policy of policies) await expect(links.getByRole('link', { name: policy.title, exact: true })).toHaveAttribute('href', policy.path)
  await links.getByRole('link', { name: 'Kebijakan Privasi', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kebijakan Privasi', exact: true })).toBeVisible()
  await expect(page.locator('article')).toContainText('Permintaan ditangani manual')
})
