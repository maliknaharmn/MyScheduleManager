import { expect, test, type Page } from '@playwright/test'
import type { Occurrence, Schedule } from '../src/api/resources'
import { overviewRange } from './overview-fixture'

test.use({ timezoneId: 'America/Los_Angeles' })

const examples = [
  ['2026-10-12', '09:00', '10:00', 'Arsip Oktober'],
  ['2026-11-03', '09:00', '10:00', 'Evaluasi sebelumnya'],
  ['2026-11-05', '09:00', '11:00', 'Kerja fokus'],
  ['2026-11-05', '13:00', '15:00', 'Rapat tim'],
  ['2026-11-06', '09:00', '10:00', 'Tinjau dokumen'],
  ['2026-11-06', '13:00', '14:00', 'Belajar'],
  ['2026-12-06', '', '', 'Agenda tanpa jam'],
] as const

export async function calendarFixture(page: Page) {
  await page.clock.install({ time: new Date('2026-11-05T03:00:00Z') })
  const state = { auth: true, account: 'account-one', weekGate: undefined as Promise<void> | undefined, monthGate: undefined as Promise<void> | undefined, failMonth: false, monthCalls: [] as string[], weekCalls: [] as string[], writes: [] as string[], removed: new Set<string>() }
  const schedules: Schedule[] = examples.map(([date, from, to, title], index) => ({
    id: `00000000-0000-4000-8000-00000000020${index}`, title, category: 'Work', status: 'Confirmed',
    time: from ? { mode: 'daily_pattern', timezone: 'Asia/Jakarta', range_start: date, range_end: date, weekdays: [((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1], start_local_time: from, end_local_time: to, end_day_offset: 0 } : { mode: 'date_only', timezone: 'Asia/Jakarta', range_start: date, range_end: date },
    tags: [], reminder_offsets_minutes: [], version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  }))
  await page.context().route('**/api/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const ok = (data: unknown) => route.fulfill({ json: { data, meta: { request_id: 'calendar-reference-test' } } })
    const error = (status: number, message: string) => route.fulfill({ status, json: { error: { code: status === 401 ? 'AUTH_REQUIRED' : 'UNAVAILABLE', message } } })
    if (request.method() !== 'GET') state.writes.push(`${request.method()} ${path}`)
    if (path === '/status') return ok({ database: 'ready', google_login_configured: false })
    if (path === '/me') return state.auth ? ok({ user: { id: state.account, email: 'test@example.invalid', display_name: 'Nadia Putri Rahmawati' }, profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 }, csrf_token: 'synthetic', calendar: { connection_status: 'not_implemented' } }) : error(401, 'Login diperlukan.')
    if (path === '/auth/logout') { state.auth = false; return route.fulfill({ status: 204 }) }
    if (path === '/tags') return ok([])
    if (path === '/notes') return ok({ items: state.account === 'account-one' ? [{
      id: 'important-note', title: 'Siapkan dokumen', is_important: true, completed_items: 1, total_items: 3,
      reminder_status: 'off', checklist: ['Cari referensi', 'Susun outline', 'Periksa ulang'].map((title, position) => ({ id: `step-${position}`, title, position, completed_at: position === 0 ? '2026-11-04T03:00:00Z' : null })),
    }] : [], has_more: false })
    if (path === '/schedules') return ok({ items: schedules.filter(row => !state.removed.has(row.id)), has_more: false })
    if (path.startsWith('/schedules/')) {
      const row = schedules.find(row => row.id === path.split('/').at(-1))!
      if (request.method() === 'DELETE') { state.removed.add(row.id); return route.fulfill({ status: 204 }) }
      return ok(row)
    }
    if (path === '/overview/week' || path === '/overview/month') {
      const account = state.account
      const range = overviewRange(url)
      if (range.month) {
        state.monthCalls.push(range.month)
        await state.monthGate
        if (state.failMonth) return error(503, 'Kalender belum tersedia.')
      } else {
        state.weekCalls.push(url.search)
        await state.weekGate
      }
      const days = Array.from({ length: range.days }, (_, index) => {
        const value = new Date(`${range.start}T12:00:00Z`)
        value.setUTCDate(value.getUTCDate() + index)
        const date = value.toISOString().slice(0, 10)
        const rows = account === 'account-one' ? schedules.filter(row => row.time.range_start === date && !state.removed.has(row.id)) : []
        const occurrences: Occurrence[] = rows.map(row => ({
          occurrence_key: row.id, schedule_id: row.id, title: row.title, category: row.category, status: row.status,
          is_important: false, starts_at: row.time.start_local_time ? `${date}T${row.time.start_local_time}:00+07:00` : null,
          ends_at: row.time.end_local_time ? `${date}T${row.time.end_local_time}:00+07:00` : null, unknown_date: row.time.mode === 'date_only' ? date : null,
        }))
        const minutes = occurrences.reduce((sum, row) => sum + (row.starts_at && row.ends_at ? (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000 : 0), 0)
        return { date, level: minutes ? 'Light' : 'Free', known_scheduled_minutes: minutes, is_partial: occurrences.some(row => row.unknown_date), unknown_duration_count: occurrences.filter(row => row.unknown_date).length, occurrence_count: rows.length, important_occurrence_count: 0, has_conflicts: false, occurrences }
      })
      return ok({ ...range.metadata, week_start: range.start, week_end: days.at(-1)!.date, timezone: 'Asia/Jakarta', days })
    }
    return error(404, 'Tidak ditemukan.')
  })
  return state
}

test('the calendar follows the reference and month loading never blocks the current week', async ({ page }) => {
  const state = await calendarFixture(page)
  let release!: () => void
  state.monthGate = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Agenda Mingguan' })).toBeVisible()
    await expect(page.locator('.app-capacity-card')).toContainText('4 jam')
    await expect(page.locator('.app-capacity-reading')).toContainText('Light')
    await expect(page.getByRole('grid', { name: 'November 2026' }).getByRole('gridcell')).toHaveCount(42)
    await expect(page.getByRole('button', { name: /Pilih Kamis, 5 November 2026/ })).toHaveAttribute('aria-current', 'date')
    release()
    await expect(page.getByRole('button', { name: 'Pilih Jumat, 6 November 2026, 2 agenda' }).locator('.has-agenda')).toBeVisible()
    const summary = page.getByRole('region', { name: 'Kalender', exact: true }).getByLabel('Ringkasan agenda kalender')
    await expect(summary).toContainText('Besok · Jum, 6 Nov')
    await expect(summary).toContainText('Tinjau dokumen')
    await expect(summary).toContainText('Belajar')
    expect(state.monthCalls).toEqual(['2026-11-01'])
    const boxes = await page.locator('.app-home-top > *').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y } }))
    if (test.info().project.name === 'desktop') {
      expect(boxes[0].y).toBe(boxes[1].y)
      expect(boxes[1].y).toBe(boxes[2].y)
      expect(boxes[0].x).toBeLessThan(boxes[1].x)
      expect(boxes[1].x).toBeLessThan(boxes[2].x)
    } else {
      expect(boxes[0].y).toBeLessThan(boxes[1].y)
      expect(boxes[1].y).toBeLessThan(boxes[2].y)
    }
  } finally { release() }
})

test('selecting history updates capacity and the week, while Agenda remains upcoming-only', async ({ page }) => {
  const state = await calendarFixture(page)
  await page.goto('/')
  const calendar = page.getByRole('region', { name: 'Kalender', exact: true })
  await expect(calendar.getByRole('button', { name: 'Pilih Selasa, 3 November 2026, 1 agenda' })).toBeVisible()
  await calendar.getByRole('button', { name: /Pilih Selasa, 3 November 2026/ }).click()
  await expect(page).toHaveURL(/week=2026-11-02&date=2026-11-03/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kamis, 5 November 2026')
  await expect(page.locator('.app-capacity-card')).toContainText('1 jam')
  await expect(calendar.getByLabel('Ringkasan agenda kalender')).toContainText('Riwayat · Sel, 3 Nov')
  await calendar.getByRole('link', { name: /Evaluasi sebelumnya/ }).click()
  await expect(page.getByRole('heading', { name: 'Evaluasi sebelumnya' })).toBeVisible()
  await page.getByRole('link', { name: 'Agenda', exact: true }).first().click()
  await expect(page.getByRole('link', { name: /Evaluasi sebelumnya|Arsip Oktober/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Belajar/ })).toBeVisible()
  expect(state.writes).toEqual([])
})

test('month/year navigation and keyboard date selection retain independent today and selected markers', async ({ page }) => {
  await calendarFixture(page)
  await page.goto('/')
  const calendar = page.getByRole('region', { name: 'Kalender', exact: true })
  await calendar.getByRole('button', { name: 'Bulan sebelumnya' }).click()
  await expect(page.getByRole('grid', { name: 'Oktober 2026' })).toBeVisible()
  await calendar.getByRole('button', { name: /Pilih Senin, 12 Oktober 2026/ }).click()
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-10-12')
  await expect(calendar.getByRole('link', { name: /Arsip Oktober/ })).toBeVisible()
  const selected = calendar.getByRole('button', { name: /Pilih Senin, 12 Oktober 2026/ })
  await selected.focus()
  await selected.press('PageUp')
  await expect(page.getByRole('grid', { name: 'September 2026' })).toBeVisible()
  await expect(calendar.getByRole('button', { name: /Pilih Sabtu, 12 September 2026/ })).toBeFocused()
  await page.keyboard.press('Shift+PageUp')
  await expect(page.getByRole('grid', { name: 'September 2025' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2025-09-13')
  await expect(calendar.locator('.app-calendar-date[tabindex="0"]')).toHaveCount(1)
  await calendar.getByRole('button', { name: 'Hari ini', exact: true }).click()
  await expect(page.locator('.app-day-row.selected')).toHaveAttribute('data-date', '2026-11-05')
  await expect(calendar.getByRole('button', { name: /Pilih Kamis, 5 November 2026/ })).toHaveAttribute('aria-pressed', 'true')
})

test('month errors are retryable without pretending that unavailable dates have no agendas', async ({ page }) => {
  const state = await calendarFixture(page)
  state.failMonth = true
  await page.goto('/')
  const calendar = page.getByRole('region', { name: 'Kalender', exact: true })
  await expect(calendar.getByRole('alert')).toHaveText('Penanda kalender belum dapat dimuat.')
  await expect(page.locator('.app-capacity-card')).toContainText('4 jam')
  await expect(calendar.getByRole('button', { name: /Pilih Senin, 30 November 2026/ })).not.toHaveAttribute('aria-label', /0 agenda/)
  state.failMonth = false
  await calendar.getByRole('button', { name: 'Coba lagi' }).click()
  await expect(calendar.getByRole('button', { name: 'Pilih Minggu, 6 Desember 2026, 1 agenda' }).locator('.has-agenda')).toBeVisible()
  await calendar.getByRole('button', { name: /Pilih Minggu, 6 Desember 2026/ }).click()
  await expect(page.locator('.app-capacity-card')).toContainText('Free sementara')
})

test('late month responses and account changes never restore another account calendar', async ({ page }) => {
  const state = await calendarFixture(page)
  let release!: () => void
  state.monthGate = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/')
    await expect.poll(() => state.monthCalls.length).toBe(1)
    await page.getByRole('link', { name: 'Pengaturan', exact: true }).first().click()
    await page.getByRole('button', { name: 'Keluar', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveCount(0)
    release()
    state.auth = true
    state.account = 'account-two'
    state.monthGate = undefined
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Pilih Jumat, 6 November 2026, 0 agenda' })).toBeVisible()
    await expect(page.getByText('Tinjau dokumen', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'myschedule-week-cache-v1'))).toBe(false)
  } finally { release() }
})

test('deleting a historical agenda invalidates its calendar marker without deleting other history', async ({ page }) => {
  await calendarFixture(page)
  await page.goto('/')
  const calendar = page.getByRole('region', { name: 'Kalender', exact: true })
  await calendar.getByRole('button', { name: /Pilih Selasa, 3 November 2026/ }).click()
  await calendar.getByRole('link', { name: /Evaluasi sebelumnya/ }).click()
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  await page.getByRole('button', { name: 'Ya, hapus agenda' }).click()
  await page.getByRole('link', { name: 'Home', exact: true }).first().click()
  await expect(calendar.getByRole('button', { name: 'Pilih Selasa, 3 November 2026, 0 agenda' })).toBeVisible()
  await expect(calendar.getByRole('button', { name: 'Pilih Selasa, 3 November 2026, 0 agenda' }).locator('.has-agenda')).toHaveCount(0)
  await calendar.getByRole('button', { name: 'Bulan sebelumnya' }).click()
  await expect(calendar.getByRole('button', { name: 'Pilih Senin, 12 Oktober 2026, 1 agenda' }).locator('.has-agenda')).toBeVisible()
})

test('the production-built calendar is usable at desktop/tablet/mobile in both themes', async ({ page }) => {
  await calendarFixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Pilih Jumat, 6 November 2026, 2 agenda' })).toBeVisible()
  const widths = test.info().project.name === 'desktop' ? [1440, 768] : [390, 320]
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1440 ? 990 : 1000 })
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.screenshot({ path: `test-results/home-calendar-${theme}-${width}.png`, fullPage: true })
    }
  }
  expect(errors).toEqual([])
})
