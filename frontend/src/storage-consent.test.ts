import { beforeEach, expect, test } from 'vitest'
import { allowsStorage, CONSENT_COOKIE, parseStorageChoice, readStorageChoice, saveStorageChoice } from './storage-consent'

beforeEach(() => { document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0` })
test('missing, malformed, outdated and expired choices never grant optional storage', () => {
  expect(readStorageChoice()).toBeNull()
  expect(allowsStorage('preferences')).toBe(false)
  expect(allowsStorage('agendaCache')).toBe(false)
  for (const value of ['', '%', 'null', '{"version":2}', JSON.stringify({ version: 1, preferences: 'true', agendaCache: true, expiresAt: Date.now() + 10000 }), JSON.stringify({ version: 1, preferences: true, agendaCache: true, expiresAt: Date.now() - 1 })]) expect(parseStorageChoice(value)).toBeNull()
})
test('a necessary-only choice is recorded without granting either optional category', () => {
  expect(saveStorageChoice({ preferences: false, agendaCache: false })).toBe(true)
  expect(readStorageChoice()).toMatchObject({ version: 1, preferences: false, agendaCache: false })
  expect(readStorageChoice()!.expiresAt - Date.now()).toBeGreaterThan(179 * 86400000)
})
test('categories are independent and can be withdrawn', () => {
  saveStorageChoice({ preferences: true, agendaCache: false })
  expect(allowsStorage('preferences')).toBe(true)
  expect(allowsStorage('agendaCache')).toBe(false)
  saveStorageChoice({ preferences: false, agendaCache: true })
  expect(allowsStorage('preferences')).toBe(false)
  expect(allowsStorage('agendaCache')).toBe(true)
  saveStorageChoice({ preferences: false, agendaCache: false })
  expect(allowsStorage('agendaCache')).toBe(false)
})
