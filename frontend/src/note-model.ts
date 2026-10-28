import type { Note } from './api/resources'

export function noteToday(zone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function noteDate(date: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

export function noteStatus(note: Pick<Note, 'completed_at' | 'target_start' | 'target_end'>, today: string) {
  if (note.completed_at) return 'Selesai'
  if (note.target_end < today) return 'Lewat target'
  if (note.target_start > today) return 'Belum dimulai'
  return 'Dalam rentang target'
}

export function noteTimestamp(value: string | undefined, zone: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value))
}
