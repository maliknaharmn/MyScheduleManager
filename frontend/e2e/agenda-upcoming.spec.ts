import { expect, test, type Page } from '@playwright/test'
import type { Schedule, ScheduleTime } from '../src/api/resources'
import { overviewRange } from './overview-fixture'

test.use({ timezoneId: 'America/Los_Angeles' })

const pattern: ScheduleTime = {
  mode: 'daily_pattern', timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16',
  weekdays: [1], start_local_time: '09:00:00', end_local_time: '10:00:00', end_day_offset: 0,
}
const rows: Schedule[] = [
  ['Agenda kemarin', { ...pattern, range_start: '2026-11-15', range_end: '2026-11-15', weekdays: [7] }],
  ['Rapat pagi', pattern],
  ['Rapat pekan depan', { ...pattern, range_start: '2020-01-01', range_end: '2026-11-23' }],
  ['Kunjungan besok', { ...pattern, range_start: '2026-11-17', range_end: '2026-11-17', weekdays: [2] }],
  ['Tugas seharian', { mode: 'all_day', timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16' }],
  ['Agenda tanpa jam', { mode: 'date_only', timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16' }],
  ['Jaga malam', { ...pattern, range_start: '2026-11-15', range_end: '2026-11-15', weekdays: [7], start_local_time: '23:00:00', end_local_time: '11:00:00', end_day_offset: 1 }],
].map(([title, time], index) => ({
  id: `00000000-0000-4000-8000-00000000010${index}`, title: title as string, time: time as ScheduleTime,
  category: 'Work', status: index === 3 ? 'Tentative' : 'Confirmed', tags: [], reminder_offsets_minutes: [],
  version: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
}))

async function fixture(page: Page) {
  await page.clock.install({ time: new Date('2026-11-16T02:59:50Z') })
  const state = { requests: [] as string[], writes: [] as string[], capped: false }
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const ok = (data: unknown) => route.fulfill({ json: { data, meta: { request_id: 'upcoming-test' } } })
    if (request.method() !== 'GET') state.writes.push(`${request.method()} ${path}`)
    if (path === '/me') return ok({ user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', display_name: 'Nadia' }, profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 }, csrf_token: 'test', calendar: { connection_status: 'not_implemented' } })
    if (path === '/status') return ok({ database: 'ready', google_login_configured: false })
    if (path === '/schedules') {
      state.requests.push(url.search)
      if (state.capped) {
        const refill = state.requests.length > 1
        return ok({ items: [
          ...rows.filter(row => row.title !== 'Agenda kemarin' && (!refill || row.title !== 'Rapat pagi')),
          ...(refill ? [{ ...rows[3], id: 'refill', title: 'Agenda berikutnya dalam daftar' }] : []),
        ], has_more: !refill })
      }
      // Return cached/older rows too: the live clock must hide them without a refetch.
      return ok({ items: rows, has_more: false })
    }
    if (path.startsWith('/schedules/')) return ok(rows.find(row => row.id === path.split('/').at(-1)))
    if (path === '/notes') return ok({ items: [], has_more: false })
    if (path === '/overview/week' || path === '/overview/month') {
      const { start, days: count, metadata } = overviewRange(url)
      const days = Array.from({ length: count }, (_, index) => {
        const day = new Date(`${start}T12:00:00Z`)
        day.setUTCDate(day.getUTCDate() + index)
        const date = day.toISOString().slice(0, 10)
        const history = date === '2026-11-15'
        return { date, level: history ? 'Light' : 'Free', known_scheduled_minutes: history ? 60 : 0, is_partial: false, unknown_duration_count: 0, occurrence_count: history ? 1 : 0, important_occurrence_count: 0, has_conflicts: false, occurrences: history ? [{ occurrence_key: 'history-15', schedule_id: rows[0].id, title: rows[0].title, category: 'Work', status: 'Confirmed', is_important: false, starts_at: '2026-11-15T09:00:00+07:00', ends_at: '2026-11-15T10:00:00+07:00', unknown_date: null }] : [] }
      })
      return ok({ ...metadata, week_start: start, week_end: days.at(-1)!.date, timezone: 'Asia/Jakarta', days })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } })
  })
  return state
}

test('Agenda only lists ongoing/future schedules; search and status do not resurrect history', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/agenda')
  await expect(page.getByRole('link', { name: /Rapat pagi/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Jaga malam/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Agenda kemarin/ })).toHaveCount(0)
  expect(state.requests).toEqual(['?limit=100&upcoming=true'])
  await page.getByLabel('Cari judul agenda').fill('kemarin')
  await expect(page.getByRole('heading', { name: 'Tidak ada hasil' })).toBeVisible()
  await page.getByLabel('Cari judul agenda').fill('')
  await page.getByLabel('Filter status').selectOption('Tentative')
  await expect(page.locator('.app-list-item')).toHaveCount(1)
  await expect(page.getByRole('link', { name: /Kunjungan besok/ })).toBeVisible()
  await page.getByLabel('Filter status').selectOption('all')
  await expect(page.locator('.app-list-item')).toHaveCount(6)
  expect(state.writes).toEqual([])
})

test('end-minute expiry and recurring dates update automatically without deletion or reload', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/agenda')
  await expect(page.getByRole('link', { name: /Rapat pagi/ })).toBeVisible()
  await page.clock.fastForward(11_000)
  await expect(page.getByRole('link', { name: /Rapat pagi/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Rapat pekan depan/ })).toContainText('23 Nov 2026')
  await expect(page.getByRole('link', { name: /Jaga malam/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Tugas seharian/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Agenda tanpa jam/ })).toBeVisible()
  await page.clock.setSystemTime(new Date('2026-11-16T17:00:00Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('link', { name: /Tugas seharian|Agenda tanpa jam|Jaga malam/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Kunjungan besok/ })).toBeVisible()
  expect(state.writes).toEqual([])
})

test('expired agenda details and historical Home capacity remain available', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/agenda')
  await expect(page.getByRole('link', { name: /Agenda kemarin/ })).toHaveCount(0)
  await page.goto('/?week=2026-11-09&date=2026-11-15')
  await expect(page.getByRole('link', { name: 'Lihat detail kapasitas Minggu, 15 November 2026' })).toContainText('1 jam')
  await page.locator('.app-week-panel').getByRole('link', { name: /Agenda kemarin/ }).click()
  await expect(page.getByRole('heading', { name: 'Agenda kemarin' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible()
  expect(state.writes).toEqual([])
})

test('a capped list refills when an agenda expires without polling ordinary lists', async ({ page }) => {
  const state = await fixture(page)
  state.capped = true
  await page.goto('/agenda')
  await expect(page.getByRole('link', { name: /Rapat pagi/ })).toBeVisible()
  expect(state.requests).toHaveLength(1)
  await page.clock.fastForward(11_000)
  await expect(page.getByRole('link', { name: /Rapat pagi/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Agenda berikutnya dalam daftar/ })).toBeVisible()
  expect(state.requests).toHaveLength(2)
  await page.clock.fastForward(60_000)
  expect(state.requests).toHaveLength(2)
  expect(state.writes).toEqual([])
})

test('the filtered Agenda retains readable light/dark layouts without overflow', async ({ page }) => {
  await fixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/agenda')
  await expect(page.getByRole('link', { name: /Rapat pagi/ })).toBeVisible()
  const widths = test.info().project.name === 'desktop' ? [1440, 768] : [390]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.screenshot({ path: `test-results/agenda-upcoming-${theme}-${width}.png`, fullPage: true })
    }
  }
  expect(errors).toEqual([])
})
