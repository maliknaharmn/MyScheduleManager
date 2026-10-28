import { expect, test } from 'vitest'
import { clockMinutes, endAfter, suggestedStart } from './agenda-time'

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
