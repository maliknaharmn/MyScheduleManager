import { useSyncExternalStore } from 'react'

export const CONSENT_COOKIE = 'myschedule_storage'
const EVENT = 'myschedule:storage-choice'
const CHANNEL = 'myschedule-storage-choice'
const LIFETIME = 180 * 24 * 60 * 60
export type StorageChoice = { version: 1; preferences: boolean; agendaCache: boolean; expiresAt: number }

let writeBlocked = false
function cookieValue() {
  try { return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1) ?? '' }
  catch { return '' }
}
function rawChoice() { return writeBlocked ? '' : cookieValue() }
export function parseStorageChoice(raw: string): StorageChoice | null {
  try {
    const value = JSON.parse(decodeURIComponent(raw))
    return value.version === 1 && typeof value.preferences === 'boolean' && typeof value.agendaCache === 'boolean' && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() ? value : null
  } catch { return null }
}
export function readStorageChoice() { return parseStorageChoice(rawChoice()) }
export function allowsStorage(kind: 'preferences' | 'agendaCache') { return readStorageChoice()?.[kind] === true }
export function removeThemeCookie() {
  try { document.cookie = `myschedule_theme=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}` } catch { /* Browser storage is optional. */ }
}
export function persistTheme(theme: 'light' | 'dark') {
  if (!allowsStorage('preferences')) return
  try { document.cookie = `myschedule_theme=${theme}; Path=/; Max-Age=2592000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}` } catch { /* Keep the in-memory theme usable. */ }
}
function subscribe(onChange: () => void) {
  let channel: BroadcastChannel | undefined
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = onChange } catch { /* Focus also rechecks consent across tabs. */ }
  window.addEventListener(EVENT, onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('pageshow', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    channel?.close()
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('pageshow', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}
// A primitive snapshot avoids useSyncExternalStore's fresh-object render loop.
export function useStorageChoice() {
  const raw = useSyncExternalStore(subscribe, rawChoice, () => '')
  return parseStorageChoice(raw)
}
export function saveStorageChoice(choices: Pick<StorageChoice, 'preferences' | 'agendaCache'>) {
  const value: StorageChoice = { ...choices, version: 1, expiresAt: Date.now() + LIFETIME * 1000 }
  try { document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Max-Age=${LIFETIME}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}` } catch { /* Verify below and fail closed. */ }
  const stored = parseStorageChoice(cookieValue())
  writeBlocked = !stored || stored.expiresAt !== value.expiresAt || stored.preferences !== choices.preferences || stored.agendaCache !== choices.agendaCache
  if (!writeBlocked && choices.preferences) persistTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  else removeThemeCookie()
  window.dispatchEvent(new Event(EVENT))
  if (writeBlocked) return false
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage('changed'); channel.close() } catch { /* No third-party scripts or trackers. */ }
  return true
}
export function openStorageSettings(trigger: HTMLButtonElement) {
  window.dispatchEvent(new CustomEvent('myschedule:storage-settings', { detail: trigger }))
}
