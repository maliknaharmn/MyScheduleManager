import { expect, test, type Page } from '@playwright/test'
import type { NoteDetail } from '../src/api/resources'

const id = '22222222-2222-4222-8222-222222222222'
const initial = (): NoteDetail => ({
  id, title: 'Siapkan dokumen', body: 'Periksa kelengkapan.\n\nSimpan salinan.',
  target_start: '2026-11-17', target_end: '2026-11-20', is_important: true,
  completed_at: null, version: 1, completed_items: 1, total_items: 3,
  reminder_enabled: false, reminder_status: 'off', prerequisite_count: 0, dependent_count: 0, has_calendar_mapping: false,
  created_at: '2026-10-26T02:00:00Z', updated_at: '2026-10-27T03:00:00Z',
  checklist: ['Cari referensi', 'Susun outline', 'Periksa ulang'].map((title, position) => ({ id: `item-${position}`, title, position, completed_at: position === 0 ? '2026-10-27T03:00:00Z' : null })),
})

async function fixture(page: Page) {
  const state = { row: initial() as NoteDetail | null, failSave: false, failDelete: false, writes: [] as Record<string, unknown>[], calendarCalls: 0 }
  await page.context().route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace('/api/v1', '')
    const ok = (data: unknown, status = 200) => route.fulfill({ status, json: { data, meta: { request_id: 'notes-test' } } })
    const error = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message } } })
    if (path === '/me') return ok({ user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', display_name: 'Test' }, profile: { timezone: 'Asia/Jakarta', daily_reminder_time: '08:00', version: 1 }, csrf_token: 'test', calendar: { connection_status: 'not_implemented' } })
    if (path === '/status') return ok({ database: 'ready', google_login_configured: false })
    if (path === '/tags') return ok([])
    if (path === '/overview/week') {
      state.calendarCalls++
      const start = url.searchParams.get('week_start')!
      const days = Array.from({ length: 35 }, (_, index) => {
        const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index)
        return { date: date.toISOString().slice(0, 10), level: 'Free', known_scheduled_minutes: 0, is_partial: false, unknown_duration_count: 0, occurrence_count: 0, important_occurrence_count: 0, has_conflicts: false, occurrences: [] }
      })
      return ok({ week_start: start, week_end: days.at(-1)!.date, timezone: 'Asia/Jakarta', days })
    }
    if (path === '/notes' && req.method() === 'GET') {
      const completion = url.searchParams.get('completion')
      const row = state.row
      return ok({ items: row && (completion === 'all' || (completion === 'completed' ? row.completed_at : !row.completed_at)) ? [row] : [], has_more: false })
    }
    if (path === '/notes' && req.method() === 'POST') {
      const body = req.postDataJSON()
      state.writes.push(body)
      state.row = { ...initial(), ...body, checklist: body.checklist.map((item: { title: string }, position: number) => ({ ...item, id: `new-${position}`, position, completed_at: null })), completed_items: 0, total_items: body.checklist.length }
      return ok(state.row, 201)
    }
    if (path.startsWith(`/notes/${id}`)) {
      if (!state.row) return error(404, 'NOTE_NOT_FOUND', 'Catatan tidak ditemukan.')
      if (req.method() === 'GET') return ok(state.row)
      expect(req.headers()['x-csrf-token']).toBe('test')
      const body = req.postDataJSON()
      state.writes.push(body)
      if (state.failSave && req.method() === 'PATCH') return error(503, 'UNAVAILABLE', 'Simpan belum berhasil.')
      if (state.failDelete && req.method() === 'DELETE') return error(503, 'UNAVAILABLE', 'Hapus belum berhasil.')
      if (body.expected_version !== state.row.version) return error(409, 'VERSION_CONFLICT', 'Catatan berubah di perangkat lain. Muat versi terbaru.')
      if (req.method() === 'DELETE') { state.row = null; return route.fulfill({ status: 204 }) }
      let row = state.row
      if (path.endsWith('/complete')) {
        if (row.completed_items < row.total_items && !body.allow_incomplete_checklist) return error(409, 'CHECKLIST_INCOMPLETE', 'Konfirmasi diperlukan.')
        row = { ...row, completed_at: '2026-11-18T02:00:00Z' }
      } else if (path.endsWith('/reopen')) row = { ...row, completed_at: null }
      else if (path.includes('/checklist-items/')) row = { ...row, checklist: row.checklist.map((item) => item.id === path.split('/').at(-1) ? { ...item, completed_at: body.completed ? '2026-11-18T02:00:00Z' : null } : item) }
      else row = { ...row, ...body, checklist: body.checklist.map((item: { id?: string; title: string }, position: number) => ({ ...item, id: item.id ?? `new-${position}`, position, completed_at: row.checklist.find((old) => old.id === item.id)?.completed_at ?? null })) }
      state.row = { ...row, version: state.row.version + 1, total_items: row.checklist.length, completed_items: row.checklist.filter((item) => item.completed_at).length }
      return ok(state.row)
    }
    return error(404, 'NOT_FOUND', 'Not found')
  })
  return state
}

test('detail, checklist management and editing preserve checked steps', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/notes/${id}`)
  await expect(page.getByRole('heading', { name: 'Siapkan dokumen' })).toBeVisible()
  await expect(page.locator('.notes-body')).toHaveCSS('white-space', 'pre-wrap')
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  await page.getByRole('link', { name: 'Kelola checklist' }).click()
  await page.getByLabel('Judul catatan').fill('Berkas final')
  await page.getByLabel('Isi catatan').fill('Rincian baru.\n\nParagraf berikutnya.')
  await page.getByRole('button', { name: 'Turunkan langkah 1' }).click()
  await page.getByRole('button', { name: 'Hapus langkah 3' }).click()
  await expect(page.getByText('1 langkah lama akan dihapus')).toBeVisible()
  await page.getByRole('textbox', { name: /^Langkah 2/ }).fill('Referensi sudah diperiksa')
  await page.getByRole('button', { name: 'Tambah langkah', exact: true }).click()
  await page.getByRole('textbox', { name: /^Langkah 3/ }).fill('Kirim formulir')
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('heading', { name: 'Berkas final' })).toBeVisible()
  expect(state.writes[0]).toMatchObject({ expected_version: 1, checklist: [{ id: 'item-1', title: 'Susun outline' }, { id: 'item-0', title: 'Referensi sudah diperiksa' }, { title: 'Kirim formulir' }] })
  await expect(page.getByRole('checkbox', { name: 'Referensi sudah diperiksa' })).toBeChecked()
  expect(state.row!.completed_items).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('completion requires confirmation, reopening preserves checklist and delete requires confirmation', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/notes/${id}`)
  await page.getByRole('button', { name: 'Tandai catatan selesai' }).click()
  await expect(page.getByRole('dialog', { name: 'Selesaikan catatan?' })).toBeVisible()
  await page.getByRole('button', { name: 'Batal', exact: true }).click()
  expect(state.writes).toHaveLength(0)
  await page.getByRole('button', { name: 'Tandai catatan selesai' }).click()
  await page.getByRole('button', { name: 'Tetap selesaikan' }).click()
  await expect(page.getByRole('button', { name: 'Buka kembali' })).toBeVisible()
  expect(state.writes.at(-1)).toMatchObject({ allow_incomplete_checklist: true, expected_version: 1 })
  await expect(page.getByRole('checkbox', { name: 'Susun outline' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Edit catatan' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Buka kembali' }).click()
  await expect(page.getByRole('checkbox', { name: 'Cari referensi' })).toBeChecked()
  await page.getByRole('checkbox', { name: 'Susun outline' }).click()
  await expect(page.getByRole('checkbox', { name: 'Susun outline' })).toBeChecked()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  await page.getByRole('button', { name: 'Batal', exact: true }).click()
  expect(state.row).not.toBeNull()
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  state.failDelete = true
  await page.getByRole('button', { name: 'Ya, hapus catatan' }).click()
  await expect(page.getByRole('alert')).toHaveText('Hapus belum berhasil.')
  state.failDelete = false
  await page.getByRole('button', { name: 'Ya, hapus catatan' }).click()
  await expect(page.getByRole('heading', { name: 'Belum ada catatan' })).toBeVisible()
  expect(state.row).toBeNull()
})

test('failed and conflicting saves retain the draft until explicit reload', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/notes/${id}/edit`)
  await page.getByLabel('Judul catatan').fill('Draft saya')
  state.failSave = true
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('alert')).toHaveText('Simpan belum berhasil.')
  await expect(page.getByLabel('Judul catatan')).toHaveValue('Draft saya')
  state.failSave = false
  state.row = { ...state.row!, version: 2, title: 'Perangkat lain' }
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('alert')).toContainText('Catatan berubah di perangkat lain')
  await expect(page.getByLabel('Judul catatan')).toHaveValue('Draft saya')
  await page.getByRole('button', { name: 'Muat versi terbaru (mengganti isian)' }).click()
  await expect(page.getByLabel('Judul catatan')).toHaveValue('Perangkat lain')
  await page.getByLabel('Judul catatan').fill('Sudah ditinjau')
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('heading', { name: 'Sudah ditinjau' })).toBeVisible()
  expect(state.writes.at(-1)!.expected_version).toBe(2)
})

test('new note supports structured checklist and searchable status lists', async ({ page }) => {
  const state = await fixture(page)
  state.row = null
  await page.goto('/notes/new')
  await page.getByLabel('Judul catatan').fill('Catatan baru saya')
  await page.getByRole('button', { name: 'Tambah langkah', exact: true }).click()
  await page.getByRole('textbox', { name: /^Langkah 1/ }).fill('Persiapan')
  await page.getByRole('button', { name: 'Simpan catatan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Catatan baru saya' })).toBeVisible()
  expect(state.writes[0]).toMatchObject({ checklist: [{ title: 'Persiapan' }], reminder: { enabled: false } })
  await page.getByRole('link', { name: 'Kembali' }).click()
  await page.getByLabel('Cari catatan').fill('tidak cocok')
  await expect(page.getByRole('heading', { name: 'Tidak ada hasil' })).toBeVisible()
  await page.getByLabel('Cari catatan').fill('baru saya')
  await expect(page.getByRole('link', { name: /Catatan baru saya/ })).toBeVisible()
  await page.getByRole('button', { name: 'Selesai', exact: true }).click()
  await expect(page.getByRole('link', { name: /Catatan baru saya/ })).toHaveCount(0)
  await page.getByLabel('Cari catatan').fill('')
  await expect(page.getByRole('heading', { name: 'Belum ada yang selesai' })).toBeVisible()
  const all = page.getByRole('button', { name: 'Semua', exact: true })
  const bounds = await all.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test('note edits refresh another open tab and Home without invalidating calendar weeks', async ({ page, context }) => {
  const state = await fixture(page)
  await page.goto('/?week=2026-11-16&date=2026-11-16')
  await expect(page.getByText('Siapkan dokumen', { exact: true })).toBeVisible()
  const calls = state.calendarCalls
  const other = await context.newPage()
  await other.goto(`/notes/${id}/edit`)
  await other.getByLabel('Judul catatan').fill('Judul diperbarui')
  await other.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(other.getByRole('heading', { name: 'Judul diperbarui' })).toBeVisible()
  await expect(page.getByText('Judul diperbarui', { exact: true })).toBeVisible()
  expect(state.calendarCalls).toBe(calls)
  await other.getByRole('button', { name: 'Hapus', exact: true }).click()
  await other.getByRole('button', { name: 'Ya, hapus catatan' }).click()
  await expect(page.getByText('Judul diperbarui', { exact: true })).toHaveCount(0)
  expect(state.calendarCalls).toBe(calls)
  await other.close()
})

test('stale delete confirmation cannot remove a newer note version', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/notes/${id}`)
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  state.row = { ...state.row!, title: 'Versi lebih baru', version: 2 }
  await page.getByRole('button', { name: 'Ya, hapus catatan' }).click()
  await expect(page.getByRole('alert')).toContainText('Catatan berubah di perangkat lain')
  await expect(page.getByRole('button', { name: 'Ya, hapus catatan' })).toBeDisabled()
  await page.getByRole('button', { name: 'Tutup dan tinjau ulang' }).click()
  await expect(page.getByRole('heading', { name: 'Versi lebih baru' })).toBeVisible()
  expect(state.row).not.toBeNull()
})

test('empty checklist is honest, completed edit is guarded and deleted detail is unavailable', async ({ page }) => {
  const state = await fixture(page)
  state.row = { ...initial(), checklist: [], total_items: 0, completed_items: 0 }
  await page.goto(`/notes/${id}`)
  await expect(page.getByText('Belum ada checklist. Tidak dianggap 100% selesai.')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Tandai catatan selesai' }).click()
  await expect(page.getByRole('button', { name: 'Buka kembali' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(`/notes/${id}/edit`)
  await expect(page.getByText('Catatan sudah selesai. Buka kembali dari detail sebelum mengedit.')).toBeVisible()
  await expect(page.getByLabel('Judul catatan')).toHaveCount(0)
  state.row = null
  await page.goto(`/notes/${id}`)
  await expect(page.getByRole('heading', { name: 'Catatan tidak tersedia' })).toBeVisible()
})
