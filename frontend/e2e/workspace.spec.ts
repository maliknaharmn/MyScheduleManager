import { expect, test } from '@playwright/test'

const weekStart = '2026-11-16'
const times = [
  ['09:00', '11:00', 'Kerja fokus', 'Work'],
  ['13:00', '15:00', 'Rapat tim', 'Organization'],
  ['16:00', '18:00', 'Tinjau dokumen', 'Academic'],
] as const

function occurrence(index: number) {
  const [from, to, title, category] = times[index]
  return {
    occurrence_key: `test-${index}`, schedule_id: `00000000-0000-4000-8000-00000000000${index}`,
    title, category, status: 'Confirmed', is_important: index === 0,
    starts_at: `2026-11-16T${from}:00+07:00`, ends_at: `2026-11-16T${to}:00+07:00`,
    unknown_date: null,
  }
}

const days = Array.from({ length: 7 }, (_, index) => {
  const date = `2026-11-${String(index + 16).padStart(2, '0')}`
  return {
    date, level: index === 0 ? 'Medium' : 'Free',
    known_scheduled_minutes: index === 0 ? 360 : 0,
    is_partial: false, unknown_duration_count: 0,
    occurrence_count: index === 0 ? 3 : 0,
    important_occurrence_count: index === 0 ? 1 : 0,
    has_conflicts: false,
    occurrences: index === 0 ? [occurrence(0), occurrence(1), occurrence(2)] : [],
  }
})

test('authenticated Home follows the reference and remains usable on phone and desktop', async ({ page }) => {
  const errors: string[] = []
  let createdSchedule: Record<string, unknown> | null = null
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const envelope = (data: unknown) => ({ data, meta: { request_id: 'visual-test' } })
    if (path === '/api/v1/me') {
      await route.fulfill({ json: envelope({
        user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', display_name: 'Test' },
        profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 },
        csrf_token: 'test', calendar: { connection_status: 'not_implemented' },
      }) })
    } else if (path === '/api/v1/status') {
      await route.fulfill({ json: envelope({ phase: 'foundation', database: 'ready', google_login_configured: true, calendar_integration: 'not_implemented', capabilities: { schedules: true, notes: true, calendar_reminders: false }, auth_handshake_storage: 'single_process_memory' }) })
    } else if (path === '/api/v1/overview/week') {
      await route.fulfill({ json: envelope({ week_start: weekStart, week_end: '2026-11-22', timezone: 'Asia/Jakarta', days }) })
    } else if (path === '/api/v1/notes') {
      await route.fulfill({ json: envelope({ items: [{
        id: '00000000-0000-4000-8000-000000000009', title: 'Siapkan dokumen', body: null,
        target_start: '2026-11-17', target_end: '2026-11-20', is_important: true,
        completed_at: null, version: 1, completed_items: 1, total_items: 3,
        reminder_enabled: false, reminder_status: 'off',
        checklist: [
          { id: 'a', title: 'Cari referensi', position: 0, completed_at: '2026-11-15T10:00:00Z' },
          { id: 'b', title: 'Susun outline', position: 1, completed_at: null },
          { id: 'c', title: 'Periksa ulang', position: 2, completed_at: null },
        ],
      }], has_more: false }) })
    } else if (path === '/api/v1/tags') {
      await route.fulfill({ json: envelope([{ id: '00000000-0000-4000-8000-000000000010', name: 'Important', system_key: 'important' }]) })
    } else if (path === '/api/v1/schedules' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      createdSchedule = { ...body, id: '00000000-0000-4000-8000-000000000011', tags: [{ id: '00000000-0000-4000-8000-000000000010', name: 'Important', system_key: 'important' }], version: 1, created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' }
      await route.fulfill({ status: 201, json: envelope(createdSchedule) })
    } else if (path === '/api/v1/schedules/00000000-0000-4000-8000-000000000011' && createdSchedule) {
      await route.fulfill({ json: envelope(createdSchedule) })
    } else {
      await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } })
    }
  })
  await page.goto(`/?week=${weekStart}&date=${weekStart}`)
  await expect(page.getByRole('heading', { name: 'Agenda Mingguan' })).toBeVisible()
  await expect(page.getByText('6 jam', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Siapkan dokumen')).toBeVisible()
  await expect(page.getByText('Kerja fokus')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  expect(errors).toEqual([])
  await page.screenshot({ path: `test-results/workspace-${test.info().project.name}.png`, fullPage: true })
  await page.getByRole('link', { name: 'Tambah agenda' }).first().click()
  await expect(page.getByRole('heading', { name: 'Agenda baru' })).toBeVisible()
  await expect(page.getByLabel('Tanggal mulai')).toHaveValue('2026-11-16')
  await page.getByLabel('Judul agenda').fill('Rapat perencanaan')
  await page.getByLabel('Mulai', { exact: true }).fill('09:00')
  await page.getByLabel('Selesai', { exact: true }).fill('10:00')
  await page.getByLabel('Tandai Important').check()
  await page.getByRole('button', { name: 'Simpan agenda' }).click()
  await expect(page.getByRole('heading', { name: 'Rapat perencanaan' })).toBeVisible()
  expect(createdSchedule).toMatchObject({ title: 'Rapat perencanaan', time: { range_start: '2026-11-16', start_local_time: '09:00', end_local_time: '10:00' }, tag_ids: ['00000000-0000-4000-8000-000000000010'] })
})
