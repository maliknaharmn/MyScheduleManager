import { expect, test } from 'vitest'
import { clockMinutes, endAfter, nextAgendaDate, suggestedStart } from './agenda-time'
import type { ScheduleTime } from './api/resources'

test('duration presets keep minute precision and explicitly mark midnight crossings', () => {
  expect(clockMinutes('09:30')).toBe(570)
  expect(endAfter('09:30', 30)).toEqual({ endTime: '10:00', overnight: false })
  expect(endAfter('23:30', 60)).toEqual({ endTime: '00:30', overnight: true })
  expect(endAfter('23:00', 60)).toEqual({ endTime: '00:00', overnight: true })
})

test('suggestions follow the profile timezone without silently changing the selected date', () => {
  const now = new Date('2026-11-16T02:12:00Z')
  expect(suggestedStart('Asia/Jakarta', true, now)).toBe('09:30')
  expect(suggestedStart('Asia/Tokyo', true, now)).toBe('11:30')
  expect(suggestedStart('Asia/Jakarta', false, now)).toBe('09:00')
  expect(suggestedStart('Asia/Jakarta', true, new Date('2026-11-16T16:58:00Z'))).toBe('23:30')
})

const pattern = (changes: Partial<ScheduleTime> = {}): ScheduleTime => ({
  mode: 'daily_pattern', timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16',
  weekdays: [1], start_local_time: '09:00:00', end_local_time: '10:00:00', end_day_offset: 0, ...changes,
})

test('timed agendas stay visible while ongoing and expire exactly at the end minute', () => {
  expect(nextAgendaDate(pattern(), new Date('2026-11-16T01:00:00Z'))).toBe('2026-11-16')
  expect(nextAgendaDate(pattern(), new Date('2026-11-16T02:59:59Z'))).toBe('2026-11-16')
  expect(nextAgendaDate(pattern(), new Date('2026-11-16T03:00:00Z'))).toBeNull()
  const interval: ScheduleTime = { mode: 'timed_interval', timezone: 'Asia/Jakarta', starts_at: '2026-11-15T20:00:00Z', ends_at: '2026-11-16T03:00:00Z' }
  expect(nextAgendaDate(interval, new Date('2026-11-16T02:59:59Z'))).toBe('2026-11-16')
  expect(nextAgendaDate(interval, new Date('2026-11-16T03:00:00Z'))).toBeNull()
})

test('overnight tails expire after their actual next-day end, not their start date', () => {
  const value = pattern({ range_start: '2026-11-15', range_end: '2026-11-15', weekdays: [7], start_local_time: '23:00:00', end_local_time: '01:00:00', end_day_offset: 1 })
  expect(nextAgendaDate(value, new Date('2026-11-15T17:59:59Z'))).toBe('2026-11-15')
  expect(nextAgendaDate(value, new Date('2026-11-15T18:00:00Z'))).toBeNull()
})

test('recurring agendas advance to the next selected weekday and expire after the final real occurrence', () => {
  const value = pattern({ range_start: '2020-01-01', range_end: '2026-11-24', weekdays: [1] })
  expect(nextAgendaDate(value, new Date('2026-11-16T03:00:00Z'))).toBe('2026-11-23')
  expect(nextAgendaDate(value, new Date('2026-11-23T03:00:00Z'))).toBeNull()
  expect(nextAgendaDate(pattern({ range_start: '2030-11-04', range_end: '2030-11-04' }), new Date('2026-11-16T03:00:00Z'))).toBe('2030-11-04')
})

test('date-only and all-day agendas last through their final selected day in the saved timezone', () => {
  for (const mode of ['date_only', 'all_day'] as const) {
    const value: ScheduleTime = { mode, timezone: 'Asia/Jakarta', range_start: '2026-11-16', range_end: '2026-11-16' }
    expect(nextAgendaDate(value, new Date('2026-11-16T16:59:59Z'))).toBe('2026-11-16')
    expect(nextAgendaDate(value, new Date('2026-11-16T17:00:00Z'))).toBeNull()
    expect(nextAgendaDate({ ...value, timezone: 'America/Los_Angeles' }, new Date('2026-11-17T07:59:59Z'))).toBe('2026-11-16')
    expect(nextAgendaDate({ ...value, timezone: 'Pacific/Kiritimati' }, new Date('2026-11-16T10:00:00Z'))).toBeNull()
    expect(nextAgendaDate({ ...value, range_start: '2026-11-14', range_end: '2026-11-17', weekdays: [6] }, new Date('2026-11-16T00:00:00Z'))).toBeNull()
  }
})

test('weekday cycles work over month, year, leap-day and timezone clock changes', () => {
  expect(nextAgendaDate(pattern({ range_start: '2026-01-01', range_end: '2027-01-08', weekdays: [5] }), new Date('2026-12-31T22:00:00Z'))).toBe('2027-01-01')
  expect(nextAgendaDate(pattern({ range_start: '2028-02-01', range_end: '2028-03-01', weekdays: [2] }), new Date('2028-02-28T22:00:00Z'))).toBe('2028-02-29')
  const value = pattern({ timezone: 'America/New_York', range_start: '2026-03-08', range_end: '2026-03-08', weekdays: [7], start_local_time: '09:00:00', end_local_time: '10:00:00' })
  expect(nextAgendaDate(value, new Date('2026-03-08T13:59:59Z'))).toBe('2026-03-08')
  expect(nextAgendaDate(value, new Date('2026-03-08T14:00:00Z'))).toBeNull()
})
