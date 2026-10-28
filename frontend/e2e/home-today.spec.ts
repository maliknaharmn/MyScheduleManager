import { expect, test, type Page } from '@playwright/test'

// The account date must win over a browser on the other side of midnight.
test.use({ timezoneId: 'America/Los_Angeles' })

async function workspace(page: Page, time = '2026-10-28T03:41:00Z') {
  await page.clock.install({ time: new Date(time) })
  const state = { weeks: [] as string[], saves: [] as { title: string; time: { range_start: string; range_end: string } }[] }
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace('/api/v1', '')
    const ok = (data: unknown, status = 200) => route.fulfill({ status, json: { data, meta: { request_id: 'home-today-test' } } })
    if (path === '/me') return ok({ user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', display_name: 'Test' }, profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 }, csrf_token: 'test', calendar: { connection_status: 'not_implemented' } })
    if (path === '/status') return ok({ database: 'ready', google_login_configured: false })
    if (path === '/tags') return ok([])
    if (path === '/overview/week') {
      const start = url.searchParams.get('week_start')!
      state.weeks.push(start)
      const days = Array.from({ length: Number(url.searchParams.get('weeks') ?? 1) * 7 }, (_, index) => {
        const value = new Date(`${start}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + index)
        const date = value.toISOString().slice(0, 10)
        const busy = date === '2026-10-28'
        return { date, level: busy ? 'Medium' : 'Free', known_scheduled_minutes: busy ? 570 : 0, is_partial: false, unknown_duration_count: 0, occurrence_count: busy ? 1 : 0, important_occurrence_count: 0, has_conflicts: false, occurrences: busy ? [{ occurrence_key: 'magang-28', schedule_id: 'existing-agenda', title: 'Magang', category: 'Work', status: 'Confirmed', is_important: false, starts_at: '2026-10-28T07:00:00+07:00', ends_at: '2026-10-28T16:30:00+07:00', unknown_date: null }] : [] }
      })
      return ok({ week_start: start, week_end: days.at(-1)!.date, timezone: 'Asia/Jakarta', days })
    }
    if (path === '/schedules' && req.method() === 'POST') {
      const body = req.postDataJSON()
      state.saves.push(body)
      return ok({ ...body, id: 'new-agenda', tags: [], version: 1, created_at: '2026-10-28T03:00:00Z', updated_at: '2026-10-28T03:00:00Z' }, 201)
    }
    if (path === '/notes' || path === '/schedules') return ok({ items: [], has_more: false })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } })
  })
  return state
}

test('fresh Home and reload use today in the account timezone for heading, highlight and capacity', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rabu, 28 Oktober 2026')
  await expect(page.locator('.app-greeting')).toHaveText('Selamat pagi, Test')
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByRole('button', { name: 'Buka agenda Rabu, 28 Oktober 2026' })).toHaveAttribute('aria-current', 'date')
  await expect(page.getByRole('link', { name: 'Lihat detail kapasitas Rabu, 28 Oktober 2026' })).toContainText('9 jam 30 menit')
  expect(state.weeks[0]).toBe('2026-10-26')
  await page.reload()
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rabu, 28 Oktober 2026')
})

test('clicking an occupied date opens add agenda without editing the existing agenda', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/')
  const date = page.getByRole('button', { name: 'Buka agenda Rabu, 28 Oktober 2026' })
  await date.focus()
  await date.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Rabu, 28 Oktober 2026' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Tambah agenda' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(date).toBeFocused()
  await date.click()
  await page.getByRole('dialog').getByRole('link', { name: 'Tambah agenda' }).click()
  await expect(page.getByLabel('Tanggal mulai')).toHaveValue('2026-10-28')
  await page.getByLabel('Judul agenda').fill('Agenda tambahan')
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agenda tambahan' })).toBeVisible()
  expect(state.saves[0].time).toMatchObject({ range_start: '2026-10-28', range_end: '2026-10-28' })
})

test('empty dates offer add and day details; Today restores the current week and highlight', async ({ page }) => {
  await workspace(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Buka agenda Jumat, 30 Oktober 2026' }).click()
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-30')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rabu, 28 Oktober 2026')
  await page.getByRole('dialog').getByRole('link', { name: 'Tambah agenda' }).click()
  await expect(page.getByLabel('Tanggal mulai')).toHaveValue('2026-10-30')
  await page.getByRole('link', { name: 'Home', exact: true }).first().click()
  await page.getByRole('button', { name: 'Minggu berikutnya' }).click()
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-11-02')
  await page.getByRole('button', { name: 'Kembali ke hari ini' }).click()
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-28')
  await page.getByRole('button', { name: 'Buka agenda Jumat, 30 Oktober 2026' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Lihat detail hari' }).click()
  await expect(page).toHaveURL(/\/day\/2026-10-30$/)
})

test('midnight advances the default selection and week across Sunday to Monday', async ({ page }) => {
  await workspace(page, '2026-11-01T16:59:50Z')
  await page.goto('/')
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-11-01')
  await page.clock.fastForward(11_000)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Senin, 0?2 November 2026/)
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-11-02')
  await expect(page.getByRole('button', { name: /Buka agenda Senin, 0?2 November 2026/ })).toHaveAttribute('aria-current', 'date')
})

test('returning from sleep refreshes today while explicit week/date links still work', async ({ page }) => {
  await workspace(page)
  await page.goto('/')
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-28')
  await page.clock.setSystemTime(new Date('2026-11-02T03:00:00Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Senin, 0?2 November 2026/)
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-11-02')
  await page.goto('/?week=2026-10-26&date=2026-10-30')
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-30')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Senin, 0?2 November 2026/)
})
