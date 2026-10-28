import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ListResult, Note, NoteDetail } from './api/resources'
import { notesChanged } from './week-cache'

const row: NoteDetail = {
  id: 'note', title: 'Target', body: null, target_start: '2026-11-17', target_end: '2026-11-20',
  is_important: true, completed_at: null, version: 1, checklist: [], completed_items: 0, total_items: 0,
  reminder_enabled: false, reminder_status: 'off', created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
  prerequisite_count: 0, dependent_count: 0, has_calendar_mapping: false,
}
afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const messages: unknown[] = []
  vi.stubGlobal('BroadcastChannel', class { postMessage(value: unknown) { messages.push(value) }; close() {} })
  const client = new QueryClient()
  client.setQueryData(['notes', 'open'], { items: [row], has_more: false })
  client.setQueryData(['notes', 'completed'], { items: [], has_more: false })
  client.setQueryData(['notes', 'all'], { items: [row], has_more: false })
  client.setQueryData(['week', 'owner', 'Asia/Jakarta', '2026-11-16'], { unchanged: true })
  return { client, messages }
}
const items = (client: QueryClient, filter: string) => client.getQueryData<ListResult<Note>>(['notes', filter])!.items

it('moves a server-confirmed completed note between filters without invalidating weeks', async () => {
  const { client, messages } = fixture()
  const completed = { ...row, completed_at: '2026-11-18T02:00:00Z', version: 2 }
  await notesChanged(client, completed, row.id)
  expect(items(client, 'open')).toEqual([])
  expect(items(client, 'completed')).toEqual([completed])
  expect(items(client, 'all')).toEqual([completed])
  expect(client.getQueryData(['note', row.id])).toEqual(completed)
  expect(client.getQueryState(['week', 'owner', 'Asia/Jakarta', '2026-11-16'])!.isInvalidated).toBe(false)
  expect(messages).toEqual(['notes-changed'])
  client.clear()
})

it('removes deleted notes from all lists and detail cache', async () => {
  const { client } = fixture()
  client.setQueryData(['note', row.id], row)
  await notesChanged(client, null, row.id)
  for (const filter of ['open', 'completed', 'all']) expect(items(client, filter)).toEqual([])
  expect(client.getQueryData(['note', row.id])).toBeUndefined()
  client.clear()
})

it('cancels an older list request before applying the confirmed edit', async () => {
  const { client } = fixture()
  let resolve!: (value: ListResult<Note>) => void
  const request = client.fetchQuery({ queryKey: ['notes', 'open'], queryFn: () => new Promise<ListResult<Note>>((done) => { resolve = done }) }).catch(() => undefined)
  const edited = { ...row, title: 'Renamed', version: 2 }
  await notesChanged(client, edited, row.id)
  resolve({ items: [row], has_more: false })
  await request
  expect(items(client, 'open')).toEqual([edited])
  client.clear()
})
