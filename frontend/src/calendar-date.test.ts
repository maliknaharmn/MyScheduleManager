import { expect, test } from 'vitest'
import { addDays, changeMonth, formatDay, localIso, mondayOf, monthDates, shiftMonthDate, todayInZone } from './calendar-date'

test('a calendar month has six complete Monday-first weeks including adjacent-month dates', () => {
  const dates = monthDates('2026-11-01')
  expect(dates).toHaveLength(42)
  expect(dates[0]).toBe('2026-10-26')
  expect(dates[41]).toBe('2026-12-06')
  expect(dates.filter(date => date.startsWith('2026-11'))).toHaveLength(30)
  expect(new Set(dates).size).toBe(42)
  expect(mondayOf('2026-11-01')).toBe('2026-10-26')
})

test('month and keyboard navigation cross year/leap boundaries without changing the intended day', () => {
  expect(changeMonth('2026-12-01', 1)).toBe('2027-01-01')
  expect(changeMonth('2026-01-01', -1)).toBe('2025-12-01')
  expect(shiftMonthDate('2028-01-31', 1)).toBe('2028-02-29')
  expect(shiftMonthDate('2027-01-31', 1)).toBe('2027-02-28')
  expect(shiftMonthDate('2028-02-29', -12)).toBe('2027-02-28')
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
})

test('old dates and date headings are civil dates rather than browser timezone conversions', () => {
  expect(monthDates('2000-02-01')).toContain('2000-02-29')
  expect(formatDay('2026-11-05', { dateStyle: 'full' })).toBe('Kamis, 5 November 2026')
  expect(formatDay('2026-11-01', { month: 'long', year: 'numeric' })).toBe('November 2026')
  expect(todayInZone('Asia/Jakarta', new Date('2026-11-05T17:00:00Z'))).toBe('2026-11-06')
  expect(localIso('2026-11-05T17:00:00Z', 'America/Los_Angeles')).toBe('2026-11-05')
})
