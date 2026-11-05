// Calendar dates are civil dates, not browser-local instants. Noon UTC keeps DST
// and a browser in another timezone out of month/week arithmetic.
export function calendarDate(iso: string) { return new Date(`${iso}T12:00:00Z`) }
export function dateIso(value: Date) { return value.toISOString().slice(0, 10) }
export function todayInZone(zone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function localIso(timestamp: string, zone: string) { return todayInZone(zone, new Date(timestamp)) }
export function addDays(iso: string, amount: number) {
  const value = calendarDate(iso)
  value.setUTCDate(value.getUTCDate() + amount)
  return dateIso(value)
}
export function mondayOf(iso: string) { return addDays(iso, -((calendarDate(iso).getUTCDay() + 6) % 7)) }
export function monthOf(iso: string) { return `${iso.slice(0, 7)}-01` }
export function changeMonth(iso: string, amount: number) {
  const value = calendarDate(monthOf(iso))
  value.setUTCMonth(value.getUTCMonth() + amount)
  return dateIso(value)
}
export function shiftMonthDate(iso: string, amount: number) {
  const start = changeMonth(iso, amount)
  const last = addDays(changeMonth(start, 1), -1)
  return `${start.slice(0, 7)}-${String(Math.min(Number(iso.slice(-2)), Number(last.slice(-2)))).padStart(2, '0')}`
}
export function monthDates(month: string) {
  const start = mondayOf(monthOf(month))
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}
export function formatDay(iso: string, options: Intl.DateTimeFormatOptions) {
  // ICU's full preset can pad single-digit days differently across browsers.
  const format: Intl.DateTimeFormatOptions = options.dateStyle === 'full'
    ? { ...options, dateStyle: undefined, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : options
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', ...format }).format(calendarDate(iso))
}
