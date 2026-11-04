import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, type Me } from './api/client'
import type { ListResult, Note, NoteDetail, WeekOverview } from './api/resources'
import { allowsStorage, useStorageChoice } from './storage-consent'

const DB_NAME = 'myschedule-week-cache-v1'
const STORE = 'weeks'
const RETENTION = 30 * 24 * 60 * 60 * 1000
const CHANNEL = 'myschedule-calendar-cache'
let generation = 0
let database: Promise<IDBDatabase | null> | undefined
type CachedWeek = { key: string; account: string; savedAt: number; value: WeekOverview }

function openDatabase() {
  if (!database) database = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('account', 'account')
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = undefined }
        resolve(request.result)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return database
}

async function storedWeeks(account: string): Promise<CachedWeek[]> {
  if (!allowsStorage('agendaCache')) return []
  const db = await openDatabase()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).index('account').getAll(account)
      request.onsuccess = () => resolve(request.result as CachedWeek[])
      request.onerror = () => resolve([])
      transaction.onabort = () => resolve([])
    } catch { resolve([]) }
  })
}

async function writeWeeks(account: string, weeks: WeekOverview[], epoch: number) {
  if (!allowsStorage('agendaCache')) return
  const db = await openDatabase()
  if (!db || epoch !== generation || !allowsStorage('agendaCache')) return
  try {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.onerror = () => { /* Cache is optional, never block the app on quota errors. */ }
    const store = transaction.objectStore(STORE)
    const now = Date.now()
    const cursor = store.openCursor()
    cursor.onsuccess = () => {
      const row = cursor.result
      if (row) {
        if (row.value.savedAt < now - RETENTION || row.value.account !== account) row.delete()
        row.continue()
      }
    }
    for (const value of weeks) store.put({ key: `${account}|${value.timezone}|${value.week_start}`, account, savedAt: now, value } satisfies CachedWeek)
  } catch { /* Private browsing or full storage falls back to memory/network. */ }
}

export async function clearWeekCache() {
  // Invalidates in-flight fetches/hydration BEFORE any asynchronous database work.
  generation++
  const db = database ? await database : null
  if (!db) {
    // Deletion must not open/create an optional database before consent.
    await new Promise<void>((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(DB_NAME)
        request.onsuccess = request.onerror = request.onblocked = () => resolve()
      } catch { resolve() }
    })
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch { resolve() }
  })
}

function notifyTabs(type: 'changed' | 'logout' | 'notes-changed') {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(type)
  channel.close()
}

export async function notesChanged(client: QueryClient, row: NoteDetail | null, id: string) {
  await Promise.all([client.cancelQueries({ queryKey: ['note', id] }), client.cancelQueries({ queryKey: ['notes'] })])
  if (row) client.setQueryData(['note', id], row)
  else client.removeQueries({ queryKey: ['note', id] })
  // Apply server-confirmed changes to the lists/Home immediately; refresh in the background.
  for (const [key, previous] of client.getQueriesData<ListResult<Note>>({ queryKey: ['notes'] })) {
    if (!previous) continue
    const items = previous.items.filter((item) => item.id !== id)
    const filter = key[1]
    if (row && (filter === 'all' || (filter === 'open' && !row.completed_at) || (filter === 'completed' && row.completed_at))) items.push(row)
    items.sort((a, b) => Number(b.is_important) - Number(a.is_important) || a.target_end.localeCompare(b.target_end) || a.id.localeCompare(b.id))
    client.setQueryData(key, { items: items.slice(0, 100), has_more: previous.has_more || items.length > 100 })
  }
  void client.invalidateQueries({ queryKey: ['notes'] })
  notifyTabs('notes-changed')
}

export async function agendaChanged(client: QueryClient, broadcast = true) {
  const clear = clearWeekCache()
  await client.cancelQueries({ predicate: (query) => ['week', 'week-prefetch'].includes(String(query.queryKey[0])) })
  client.removeQueries({ queryKey: ['week-prefetch'] })
  await clear
  // Old capacity totals must not survive edits/deletes. Refetch active views only.
  void client.resetQueries({ queryKey: ['week'] })
  void client.invalidateQueries({ queryKey: ['schedules'] })
  if (broadcast) notifyTabs('changed')
}

export async function forgetCalendar(client: QueryClient, broadcast = false) {
  const clear = clearWeekCache()
  await client.cancelQueries({ predicate: (query) => !['me', 'status'].includes(String(query.queryKey[0])) })
  await clear
  client.removeQueries({ predicate: (query) => !['me', 'status'].includes(String(query.queryKey[0])) })
  if (broadcast) notifyTabs('logout')
}

function weekKey(me: Me, start: string) { return ['week', me.user.id, me.profile.timezone, start] }

export function splitWeeks(window: WeekOverview): WeekOverview[] {
  const weeks: WeekOverview[] = []
  for (let index = 0; index + 7 <= window.days.length; index += 7) {
    const days = window.days.slice(index, index + 7)
    weeks.push({ week_start: days[0].date, week_end: days[6].date, timezone: window.timezone, days })
  }
  return weeks
}

function nextWeek(start: string) {
  const value = new Date(`${start}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 7)
  return value.toISOString().slice(0, 10)
}

async function fetchWindow(client: QueryClient, me: Me, start: string, weeks: number, signal: AbortSignal, epoch: number) {
  let window: WeekOverview
  try {
    window = await api<WeekOverview>(`/overview/week?week_start=${start}&weeks=${weeks}`, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData<Me | null>(['me'], null)
      void clearWeekCache()
    }
    throw error
  }
  if (signal.aborted || epoch !== generation) throw new DOMException('Calendar request superseded', 'AbortError')
  if (window.week_start !== start || window.timezone !== me.profile.timezone || window.days.length !== weeks * 7 || window.days[0]?.date !== start) throw new Error('Rentang atau zona waktu agenda tidak sesuai. Coba lagi.')
  return splitWeeks(window)
}

export function useWeek(me: Me, start: string) {
  const client = useQueryClient()
  const choice = useStorageChoice()
  const loadedWindow = useRef<string | null>(null)
  const windowKey = `${me.user.id}|${me.profile.timezone}|${start}`
  useEffect(() => {
    const epoch = generation
    let mounted = true
    void storedWeeks(me.user.id).then((records) => {
      if (!mounted || epoch !== generation || !allowsStorage('agendaCache')) return
      for (const record of records) {
        if (record.account !== me.user.id || typeof record.savedAt !== 'number' || record.savedAt < Date.now() - RETENTION || record.value?.timezone !== me.profile.timezone || !Array.isArray(record.value.days) || record.value.days.length !== 7) continue
        const key = weekKey(me, record.value.week_start)
        if (!client.getQueryData(key)) client.setQueryData(key, record.value, { updatedAt: record.savedAt })
      }
    })
    return () => { mounted = false }
  }, [client, me.user.id, me.profile.timezone, choice?.agendaCache])
  const query = useQuery({
    // Browser timers overflow above ~24.8 days; disk, not a timer, retains 30 days.
    queryKey: weekKey(me, start), staleTime: 60_000, gcTime: 24 * 60 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const epoch = generation
      // The visible week must not wait for another month's data or disk writes.
      const [current] = await fetchWindow(client, me, start, 1, signal, epoch)
      loadedWindow.current = windowKey
      void writeWeeks(me.user.id, [current], epoch)
      return current
    },
  })
  useEffect(() => {
    if (!query.data || query.isFetching || query.isError || loadedWindow.current !== windowKey) return
    loadedWindow.current = null
    const first = nextWeek(start)
    let future = first
    let fresh = true
    for (let index = 0; index < 4; index++) {
      const state = client.getQueryState(weekKey(me, future))
      if (!state?.data || state.isInvalidated || state.dataUpdatedAt < Date.now() - 60_000) fresh = false
      future = nextWeek(future)
    }
    if (fresh) return
    const key = ['week-prefetch', me.user.id, me.profile.timezone, first]
    const epoch = generation
    void client.fetchQuery({
      queryKey: key, staleTime: 60_000, gcTime: 60_000,
      queryFn: async ({ signal }) => {
        const weeks = await fetchWindow(client, me, first, 4, signal, epoch)
        const accepted: WeekOverview[] = []
        for (const week of weeks) {
          const target = weekKey(me, week.week_start)
          const state = client.getQueryState(target)
          // Never overwrite a foreground read or a newer, fresh result.
          if (state?.fetchStatus === 'fetching' || (state?.data && !state.isInvalidated && state.dataUpdatedAt >= Date.now() - 60_000)) continue
          client.setQueryData(target, week)
          accepted.push(week)
        }
        if (accepted.length) void writeWeeks(me.user.id, accepted, epoch)
        return true
      },
    }).catch(() => { /* Prefetch failure must not block the visible week or retry a mutation. */ })
    return () => { void client.cancelQueries({ queryKey: key, exact: true }) }
  }, [client, me, start, windowKey, query.data, query.dataUpdatedAt, query.isFetching, query.isError])
  return query
}

export function useCalendarTabSync() {
  const client = useQueryClient()
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event) => {
      if (event.data === 'changed') void agendaChanged(client, false)
      if (event.data === 'notes-changed') {
        void client.invalidateQueries({ queryKey: ['notes'] })
        void client.invalidateQueries({ queryKey: ['note'] })
      }
      if (event.data === 'logout') {
        void forgetCalendar(client).then(() => client.invalidateQueries({ queryKey: ['me'] }))
      }
    }
    return () => channel.close()
  }, [client])
}
