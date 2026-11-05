import type { ScheduleTime } from './api/resources'

export function clockMinutes(clock: string) {
  const [hours, minutes] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

export function endAfter(start: string, minutes: number) {
  const total = clockMinutes(start) + minutes
  const clock = total % 1440
  return {
    endTime: `${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`,
    overnight: total >= 1440,
  }
}

export function suggestedStart(zone: string, isToday: boolean, now = new Date()) {
  if (!isToday) return '09:00'
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const minutes = Number(parts.find((part) => part.type === 'hour')!.value) * 60 + Number(parts.find((part) => part.type === 'minute')!.value)
  // Keep today's date explicit, including when the suggested end crosses midnight.
  const rounded = Math.min(Math.ceil((minutes + 1) / 30) * 30, 1410)
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

function addDate(iso: string, days: number) {
  const value = new Date(`${iso}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

// A recurring agenda is upcoming while ANY occurrence is ongoing or still ahead.
// Use the saved agenda's zone, never the browser's zone, including overnight tails.
export function nextAgendaDate(value: ScheduleTime, now = new Date()): string | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const today = `${get('year')}-${get('month')}-${get('day')}`
  const clock = `${get('hour')}:${get('minute')}`
  if (value.mode === 'timed_interval') {
    if (!value.starts_at || !value.ends_at || new Date(value.ends_at) <= now) return null
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(value.starts_at))
    const datePart = (type: string) => dateParts.find((part) => part.type === type)?.value ?? ''
    return `${datePart('year')}-${datePart('month')}-${datePart('day')}`
  }
  if (!value.range_start || !value.range_end) return null
  const earliest = value.mode === 'daily_pattern' && value.end_day_offset ? addDate(today, -1) : today
  let day = value.range_start > earliest ? value.range_start : earliest
  // At most one full weekday cycle plus yesterday's overnight occurrence.
  for (let index = 0; index < 8 && day <= value.range_end; index++, day = addDate(day, 1)) {
    const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
    if (value.weekdays && !value.weekdays.includes(weekday)) continue
    if (value.mode !== 'daily_pattern') return day
    const endDay = addDate(day, value.end_day_offset ?? 0)
    if (endDay > today || (endDay === today && (value.end_local_time ?? '').slice(0, 5) > clock)) return day
  }
  return null
}
