import { expect, test, type Page } from '@playwright/test'
import type { Schedule } from '../src/api/resources'

type AgendaInput = Pick<Schedule, 'title' | 'category' | 'status' | 'time'> & { tag_ids: string[]; reminder_offsets_minutes: number[] }

// Synthetic API responses only; real login/CSRF/database are not bypassed in the app.
async function workspace(page: Page) {
  const state = { calls: [] as string[], saves: [] as AgendaInput[], saveGate: undefined as Promise<void> | undefined, failSave: false }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    state.calls.push(`${request.method()} ${path}`)
    const envelope = (data: unknown) => ({ data, meta: { request_id: 'quick-add-test' } })
    if (path === '/me') return route.fulfill({ json: envelope({
      user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', display_name: 'Test' },
      profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 },
      csrf_token: 'synthetic', calendar: { connection_status: 'not_implemented' },
    }) })
    if (path === '/tags') return route.fulfill({ json: envelope([{ id: '00000000-0000-4000-8000-000000000010', name: 'Important', system_key: 'important' }]) })
    if (path === '/schedules' && request.method() === 'POST') {
      const body = request.postDataJSON()
      state.saves.push(body)
      await state.saveGate
      if (state.failSave) return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Simpan belum berhasil.' } } })
      return route.fulfill({ status: 201, json: envelope({ ...body, id: 'new-agenda', tags: [], version: 1, created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' }) })
    }
    if (path === '/overview/week') {
      const start = url.searchParams.get('week_start')!
      const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${start}T12:00:00Z`)
        date.setUTCDate(date.getUTCDate() + index)
        return { date: date.toISOString().slice(0, 10), level: 'Free', known_scheduled_minutes: 0, is_partial: false, unknown_duration_count: 0, occurrence_count: 0, important_occurrence_count: 0, has_conflicts: false, occurrences: [] }
      })
      return route.fulfill({ json: envelope({ week_start: start, week_end: days[6].date, timezone: 'Asia/Jakarta', days }) })
    }
    if (path === '/notes' || path === '/schedules') return route.fulfill({ json: envelope({ items: [], has_more: false }) })
    // In particular: a redundant detail read must not be needed to display a successful save.
    return route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED_READ', message: 'Unexpected API request' } } })
  })
  return state
}

test('ordinary agenda needs only a title, saves once, and opens cached detail without reloading identity', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/agenda/new?date=2026-11-16')
  await page.getByLabel('Judul agenda').fill('Rapat singkat')
  await expect(page.getByLabel('Tanggal mulai')).toHaveValue('2026-11-16')
  await expect(page.getByLabel('Mulai', { exact: true })).toHaveValue('09:00')
  await expect(page.getByLabel('Selesai', { exact: true })).toHaveValue('10:00')
  await expect(page.getByLabel('Tanggal akhir')).toHaveCount(0)
  await expect(page.getByLabel('Kategori', { exact: true })).toHaveCount(0)
  const save = page.getByRole('button', { name: 'Simpan agenda', exact: true })
  const bounds = await save.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(page.viewportSize()!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(state.calls).not.toContain('GET /tags')
  let release!: () => void
  state.saveGate = new Promise<void>((resolve) => { release = resolve })
  await save.click()
  await expect(page.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled()
  await expect(page.getByLabel('Judul agenda')).toBeDisabled()
  expect(state.saves).toHaveLength(1)
  release()
  await expect(page.getByRole('heading', { name: 'Rapat singkat' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Agenda tersimpan')
  expect(state.saves[0]).toMatchObject({ title: 'Rapat singkat', status: 'Confirmed', category: 'Other', time: { range_start: '2026-11-16', range_end: '2026-11-16', start_local_time: '09:00', end_local_time: '10:00', end_day_offset: 0, weekdays: [1] } })
  expect(state.calls.filter((call) => call === 'GET /me')).toHaveLength(1)
  expect(state.calls).not.toContain('GET /status')
  expect(state.calls).not.toContain('GET /schedules/new-agenda')
})

test('changing the date does not require editing a second date; time and duration cross midnight explicitly', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/agenda/new?date=2026-11-16')
  await page.getByLabel('Judul agenda').fill('Kerja malam')
  await page.getByLabel('Tanggal mulai').fill('2026-11-18')
  await page.getByLabel('Mulai', { exact: true }).fill('23:30')
  await expect(page.getByLabel('Selesai', { exact: true })).toHaveValue('00:30')
  await expect(page.getByLabel('Selesai besok', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: '30 menit', exact: true }).click()
  await expect(page.getByLabel('Selesai', { exact: true })).toHaveValue('00:00')
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kerja malam' })).toBeVisible()
  expect(state.saves[0].time).toMatchObject({ range_start: '2026-11-18', range_end: '2026-11-18', weekdays: [3], end_day_offset: 1, end_local_time: '00:00' })
})

test('recurrence, category, tentative status and Important remain available', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/agenda/new?date=2026-11-16')
  await page.getByLabel('Judul agenda').fill('Rapat rutin')
  await page.getByLabel('Berulang', { exact: true }).check()
  await page.getByLabel('Tanggal akhir').fill('2026-11-20')
  await page.getByLabel('Sab', { exact: true }).uncheck()
  await page.getByLabel('Min', { exact: true }).uncheck()
  await page.getByLabel('Tandai Important').check()
  await page.getByRole('button', { name: 'Kategori & opsi lainnya' }).click()
  await page.getByRole('combobox', { name: 'Kategori', exact: true }).selectOption('Work')
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Tentative')
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Rapat rutin' })).toBeVisible()
  expect(state.saves[0]).toMatchObject({ category: 'Work', status: 'Tentative', tag_ids: ['00000000-0000-4000-8000-000000000010'], time: { range_end: '2026-11-20', weekdays: [1, 2, 3, 4, 5] } })
})

test('failed saves keep the draft; correcting and retrying is explicit, never automatic', async ({ page }) => {
  const state = await workspace(page)
  state.failSave = true
  await page.goto('/agenda/new?date=2026-11-16')
  await page.getByLabel('Judul agenda').fill('Draft tetap ada')
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Simpan belum berhasil.')
  await expect(page.getByLabel('Judul agenda')).toHaveValue('Draft tetap ada')
  await expect(page.getByLabel('Judul agenda')).toBeEnabled()
  expect(state.saves).toHaveLength(1)
  state.failSave = false
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Draft tetap ada' })).toBeVisible()
  expect(state.saves).toHaveLength(2)
})

test('without time and all-day modes do not require hidden clock fields', async ({ page }) => {
  const state = await workspace(page)
  for (const [label, mode] of [['Tanpa jam', 'date_only'], ['Seharian', 'all_day']]) {
    await page.goto('/agenda/new?date=2026-11-16')
    await page.getByLabel('Judul agenda').fill(`Agenda ${label}`)
    await page.getByLabel(label, { exact: true }).check()
    await expect(page.getByLabel('Mulai', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
    await expect(page.getByRole('heading', { name: `Agenda ${label}` })).toBeVisible()
    expect(state.saves.at(-1)!.time).toEqual({ mode, timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16', weekdays: null })
  }
})

test('returning to Home reuses fresh data; saving refreshes only agenda resources', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/')
  await expect(page.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
  await expect(page.getByText('Belum ada catatan Important.')).toBeVisible()
  await page.getByRole('link', { name: 'Tambah agenda', exact: true }).first().click()
  const beforeWeek = state.calls.filter((call) => call === 'GET /overview/week').length
  const beforeNotes = state.calls.filter((call) => call === 'GET /notes').length
  await page.getByRole('link', { name: 'Home', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Agenda Mingguan' })).toBeVisible()
  expect(state.calls.filter((call) => call === 'GET /overview/week')).toHaveLength(beforeWeek)
  expect(state.calls.filter((call) => call === 'GET /notes')).toHaveLength(beforeNotes)
  await page.getByRole('link', { name: 'Tambah agenda', exact: true }).first().click()
  await page.getByLabel('Judul agenda').fill('Tidak refresh semua')
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tidak refresh semua' })).toBeVisible()
  expect(state.calls.filter((call) => call === 'GET /notes')).toHaveLength(beforeNotes)
  expect(state.calls.filter((call) => call === 'GET /me')).toHaveLength(1)
  await page.getByRole('link', { name: 'Home', exact: true }).first().click()
  await expect(page.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
  const refreshed = state.calls.filter((call) => call === 'GET /overview/week').length - beforeWeek
  // Dev StrictMode can abort/restart the first subscribed request after a reset.
  expect(refreshed).toBeGreaterThanOrEqual(1)
  expect(refreshed).toBeLessThanOrEqual(2)
  expect(state.calls.filter((call) => call === 'GET /notes')).toHaveLength(beforeNotes)
})

test('time modes work with a keyboard and invalid overnight times cannot be silently saved', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/agenda/new?date=2026-11-16')
  await page.getByLabel('Judul agenda').fill('Periksa jam')
  await page.getByRole('radio', { name: 'Jam tertentu', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Tanpa jam', exact: true })).toBeChecked()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('radio', { name: 'Jam tertentu', exact: true })).toBeChecked()
  await page.getByLabel('Selesai', { exact: true }).fill('08:00')
  await page.getByRole('button', { name: 'Simpan agenda', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Jam selesai harus setelah mulai')
  expect(state.saves).toHaveLength(0)
  await page.getByLabel('Selesai besok', { exact: true }).check()
  await page.getByLabel('Judul agenda').press('Enter')
  await expect(page.getByRole('heading', { name: 'Periksa jam' })).toBeVisible()
  expect(state.saves).toHaveLength(1)
  expect(state.saves[0].time.end_day_offset).toBe(1)
})
