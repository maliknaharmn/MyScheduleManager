import { expect, test, type Page } from '@playwright/test'
import type { Schedule } from '../src/api/resources'

const id = '11111111-1111-4111-8111-111111111111'
const account = '00000000-0000-4000-8000-000000000001'
const original = (): Schedule => ({
  id, title: 'Rapat perencanaan', category: 'Work', status: 'Confirmed', version: 1,
  time: { mode: 'daily_pattern', timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16', weekdays: [1], start_local_time: '09:00:00', end_local_time: '10:00:00', end_day_offset: 0 },
  tags: [{ id: '00000000-0000-4000-8000-000000000010', name: 'Target', system_key: 'target' }],
  reminder_offsets_minutes: [15], created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
})

async function fixture(page: Page) {
  const state = { row: original() as Schedule | null, accountId: account, auth: true, windows: [] as string[], patches: [] as { expected_version: number; tag_ids: string[]; reminder_offsets_minutes: number[]; time: Schedule['time'] }[], deletes: 0, failDelete: false, windowGate: undefined as Promise<void> | undefined }
  await page.context().route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const ok = (data: unknown, status = 200) => route.fulfill({ status, json: { data, meta: { request_id: 'workspace-features-test' } } })
    const error = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message } } })
    if (path === '/me') return state.auth ? ok({ user: { id: state.accountId, email: 'test@example.invalid', display_name: 'Nadia Putri Rahmawati' }, profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 }, csrf_token: 'test', calendar: { connection_status: 'not_implemented' } }) : error(401, 'AUTH_REQUIRED', 'Login diperlukan.')
    if (path === '/auth/logout') { state.auth = false; return route.fulfill({ status: 204 }) }
    if (path === '/status') return ok({ database: 'ready', google_login_configured: false })
    if (path === '/tags') return ok(state.row?.tags ?? [])
    if (path === '/notes') return ok({ items: [], has_more: false })
    if (path === '/schedules') return ok({ items: state.row ? [state.row] : [], has_more: false })
    if (path === `/schedules/${id}`) {
      if (!state.row) return error(404, 'SCHEDULE_NOT_FOUND', 'Agenda tidak ditemukan.')
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON()
        state.patches.push(body)
        if (body.expected_version !== state.row.version) return error(409, 'VERSION_CONFLICT', 'Agenda berubah di perangkat lain. Muat versi terbaru.')
        state.row = { ...state.row, ...body, tags: state.row.tags, version: state.row.version + 1 }
        return ok(state.row)
      }
      if (request.method() === 'DELETE') {
        state.deletes++
        if (state.failDelete) return error(503, 'UNAVAILABLE', 'Hapus belum berhasil.')
        if (request.postDataJSON().expected_version !== state.row.version) return error(409, 'VERSION_CONFLICT', 'Agenda berubah di perangkat lain.')
        state.row = null
        return route.fulfill({ status: 204 })
      }
      return ok(state.row)
    }
    if (path === '/overview/week') {
      state.windows.push(url.search)
      await state.windowGate
      const start = url.searchParams.get('week_start')!
      const weeks = Number(url.searchParams.get('weeks') ?? 1)
      const days = Array.from({ length: weeks * 7 }, (_, index) => {
        const day = new Date(`${start}T12:00:00Z`)
        day.setUTCDate(day.getUTCDate() + index)
        const date = day.toISOString().slice(0, 10)
        const row = state.row
        const exists = row && date >= row.time.range_start! && date <= row.time.range_end!
        const minutes = exists ? 60 : 0
        return { date, level: minutes ? 'Light' : 'Free', known_scheduled_minutes: minutes, is_partial: false, unknown_duration_count: 0, occurrence_count: exists ? 1 : 0, important_occurrence_count: 0, has_conflicts: false, occurrences: exists ? [{ occurrence_key: `test-${date}`, schedule_id: row.id, title: row.title, category: row.category, status: row.status, is_important: false, starts_at: `${date}T09:00:00+07:00`, ends_at: `${date}T10:00:00+07:00`, unknown_date: null }] : [] }
      })
      return ok({ week_start: start, week_end: days.at(-1)!.date, timezone: 'Asia/Jakarta', days })
    }
    return error(404, 'NOT_FOUND', 'Not found')
  })
  return state
}

async function cachedCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const request = indexedDB.open('myschedule-week-cache-v1', 1)
    // Polling must never create an empty v1 database before the app initializes its store.
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => resolve(0)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('weeks')) { db.close(); resolve(0); return }
      const count = db.transaction('weeks').objectStore('weeks').count()
      count.onsuccess = () => { resolve(count.result); db.close() }
    }
  }))
}

test('cache is account-scoped and expired entries never render during a network wait', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(page.getByText('Rapat perencanaan', { exact: true })).toBeVisible()
  await expect.poll(() => cachedCount(page)).toBe(5)
  let release!: () => void
  state.windowGate = new Promise<void>((resolve) => { release = resolve })
  state.accountId = '00000000-0000-4000-8000-000000000002'
  state.row = { ...state.row!, title: 'Agenda akun kedua' }
  await page.reload()
  await expect(page.getByText('Memuat agenda minggu…')).toBeVisible()
  await expect(page.getByText('Rapat perencanaan', { exact: true })).toHaveCount(0)
  release()
  await expect(page.getByText('Agenda akun kedua', { exact: true })).toBeVisible()
  await expect.poll(() => cachedCount(page)).toBe(5)
  await page.evaluate(() => new Promise<void>((resolve) => {
    const request = indexedDB.open('myschedule-week-cache-v1', 1)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('weeks', 'readwrite')
      const cursor = tx.objectStore('weeks').openCursor()
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (entry) { entry.update({ ...entry.value, savedAt: Date.now() - 31 * 86400000 }); entry.continue() }
      }
      tx.oncomplete = () => { db.close(); resolve() }
    }
  }))
  state.windowGate = new Promise<void>((resolve) => { release = resolve })
  await page.reload()
  await expect(page.getByText('Memuat agenda minggu…')).toBeVisible()
  await expect(page.getByText('Agenda akun kedua', { exact: true })).toHaveCount(0)
  release()
  await expect(page.getByText('Agenda akun kedua', { exact: true })).toBeVisible()
})

test('blocked browser storage still permits network loading and in-memory weekly navigation', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Blocked', 'SecurityError') } }))
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const state = await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(page.getByText('Rapat perencanaan', { exact: true })).toBeVisible()
  const requests = state.windows.length
  await page.getByRole('button', { name: 'Minggu berikutnya' }).click()
  await expect(page.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
  expect(state.windows).toHaveLength(requests)
  expect(errors).toEqual([])
})

test('dashboard greets the full Google name; theme follows navigation order and survives reload in a cookie', async ({ page }) => {
  await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(page.getByText(/Selamat (pagi|siang|sore|malam), Nadia Putri Rahmawati/)).toBeVisible()
  const toggle = page.getByRole('switch', { name: 'Mode gelap' })
  await expect(toggle).not.toBeChecked()
  const order = await toggle.evaluate((el) => [...el.parentElement!.children].map((node) => node.textContent))
  expect(order.at(-2)).toBe('Pengaturan')
  expect(order.at(-1)).toMatch(/Tema|Mode gelap/)
  await page.screenshot({ path: `test-results/home-light-${test.info().project.name}.png`, fullPage: true })
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: `test-results/home-dark-${test.info().project.name}.png`, fullPage: true })
  const cookies = await page.context().cookies()
  expect(cookies.find((cookie) => cookie.name === 'myschedule_theme')?.value).toBe('dark')
  expect(cookies.every((cookie) => !cookie.value.includes('Rapat'))).toBe(true)
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Mode gelap' })).toBeChecked()
  await page.getByRole('switch', { name: 'Mode gelap' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('one monthly window makes the next four weeks instant and cached weeks render while reload is pending', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(page.getByText('Rapat perencanaan', { exact: true })).toBeVisible()
  await expect.poll(() => cachedCount(page)).toBe(5)
  const requests = state.windows.length
  for (let week = 0; week < 4; week++) {
    await page.getByRole('button', { name: 'Minggu berikutnya' }).click()
    await expect(page.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
    expect(state.windows).toHaveLength(requests)
    await expect(page.getByText('Memuat agenda minggu…')).toHaveCount(0)
  }
  let release!: () => void
  state.windowGate = new Promise<void>((resolve) => { release = resolve })
  await page.reload()
  await expect(page.getByText('Menampilkan cache · memperbarui…')).toBeVisible()
  await expect(page.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
  release()
  await expect(page.getByText('Menampilkan cache · memperbarui…')).toHaveCount(0)
})

test('agenda can be edited then deleted with confirmation, preserving tags/reminders and clearing the month cache', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect.poll(() => cachedCount(page)).toBe(5)
  await page.getByRole('link', { name: /Rapat perencanaan/ }).click()
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Judul agenda')).toHaveValue('Rapat perencanaan')
  await expect(page.getByLabel('Selesai', { exact: true })).toHaveValue('10:00')
  await page.getByLabel('Judul agenda').fill('Rapat dipindahkan')
  await page.getByLabel('Tanggal mulai').fill('2026-11-18')
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('heading', { name: 'Rapat dipindahkan' })).toBeVisible()
  expect(state.patches[0]).toMatchObject({ expected_version: 1, tag_ids: [original().tags[0].id], reminder_offsets_minutes: [15], time: { range_start: '2026-11-18', range_end: '2026-11-18', weekdays: [3] } })
  expect(await cachedCount(page)).toBe(0)
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Hapus agenda?' })).toBeVisible()
  await page.getByRole('button', { name: 'Batal', exact: true }).click()
  expect(state.deletes).toBe(0)
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  state.failDelete = true
  await page.getByRole('button', { name: 'Ya, hapus agenda' }).click()
  await expect(page.getByRole('alert')).toHaveText('Hapus belum berhasil.')
  await expect(page.getByRole('heading', { name: 'Rapat dipindahkan', exact: true })).toBeVisible()
  state.failDelete = false
  await page.getByRole('button', { name: 'Ya, hapus agenda' }).click()
  await expect(page.getByRole('heading', { name: 'Belum ada agenda' })).toBeVisible()
  expect(state.row).toBeNull()
  await page.getByRole('link', { name: 'Home', exact: true }).first().click()
  await expect(page.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
  await expect(page.getByText('Rapat dipindahkan', { exact: true })).toHaveCount(0)
})

test('edit conflict keeps the draft and only explicit reload replaces it', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/agenda/${id}/edit`)
  await page.getByLabel('Judul agenda').fill('Draft milik saya')
  state.row = { ...state.row!, title: 'Perubahan perangkat lain', version: 2 }
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('alert')).toContainText('Agenda berubah di perangkat lain')
  await expect(page.getByLabel('Judul agenda')).toHaveValue('Draft milik saya')
  await page.getByRole('button', { name: 'Muat versi terbaru (mengganti isian)' }).click()
  await expect(page.getByLabel('Judul agenda')).toHaveValue('Perubahan perangkat lain')
  await page.getByLabel('Judul agenda').fill('Sudah ditinjau')
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('heading', { name: 'Sudah ditinjau' })).toBeVisible()
  expect(state.patches.at(-1)!.expected_version).toBe(2)
})

test('logout clears persisted private weeks; expired sessions cannot restore them', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect.poll(() => cachedCount(page)).toBe(5)
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).first().click()
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Jadwal jelas/ })).toBeVisible()
  expect(await cachedCount(page)).toBe(0)
  state.auth = true
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect.poll(() => cachedCount(page)).toBe(5)
  state.auth = false
  await page.reload()
  await expect(page.getByRole('heading', { name: /Jadwal jelas/ })).toBeVisible()
  await expect.poll(() => cachedCount(page)).toBe(0)
  await expect(page.getByText('Rapat perencanaan', { exact: true })).toHaveCount(0)
})

test('deletion and logout invalidate already-open tabs', async ({ page, context }) => {
  await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(page.getByText('Rapat perencanaan', { exact: true })).toBeVisible()
  const other = await context.newPage()
  await other.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(other.getByText('Rapat perencanaan', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Rapat perencanaan/ }).click()
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  await page.getByRole('button', { name: 'Ya, hapus agenda' }).click()
  await expect(page.getByRole('heading', { name: 'Belum ada agenda' })).toBeVisible()
  await expect(other.getByText('0 tampilan agenda dalam minggu ini')).toBeVisible()
  await expect(other.getByText('Rapat perencanaan', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).first().click()
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await expect(other.getByRole('heading', { name: /Jadwal jelas/ })).toBeVisible()
  await other.close()
})
