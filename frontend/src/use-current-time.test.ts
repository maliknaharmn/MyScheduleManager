import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCurrentTime } from './use-current-time'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('updates at the next minute so midnight does not leave yesterday selected', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T16:59:50Z'))
  const { result } = renderHook(useCurrentTime)
  expect(result.current.toISOString()).toBe('2026-10-28T16:59:50.000Z')
  act(() => vi.advanceTimersByTime(10_000))
  expect(result.current.toISOString()).toBe('2026-10-28T17:00:00.000Z')
})

it.each(['focus', 'pageshow'])('refreshes immediately on %s after the device sleeps', (event) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T03:00:00Z'))
  const { result } = renderHook(useCurrentTime)
  vi.setSystemTime(new Date('2026-11-02T03:00:00Z'))
  act(() => window.dispatchEvent(new Event(event)))
  expect(result.current.toISOString()).toBe('2026-11-02T03:00:00.000Z')
})

it('refreshes when the document becomes visible and cleans up its timer', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T03:00:00Z'))
  const { result, unmount } = renderHook(useCurrentTime)
  vi.setSystemTime(new Date('2026-10-29T03:00:00Z'))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(result.current.toISOString()).toBe('2026-10-29T03:00:00.000Z')
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
