import { describe, expect, it } from 'vitest'
import { noteDate, noteStatus, noteToday } from './note-model'

describe('note targets', () => {
  const note = { completed_at: null, target_start: '2026-11-17', target_end: '2026-11-20' }
  it('uses the profile timezone, not the browser date', () => {
    const now = new Date('2026-11-16T18:00:00Z')
    expect(noteToday('Asia/Jakarta', now)).toBe('2026-11-17')
    expect(noteToday('America/Los_Angeles', now)).toBe('2026-11-16')
  })
  it('keeps both boundaries inside the target range', () => {
    expect(noteStatus(note, '2026-11-16')).toBe('Belum dimulai')
    expect(noteStatus(note, '2026-11-17')).toBe('Dalam rentang target')
    expect(noteStatus(note, '2026-11-20')).toBe('Dalam rentang target')
    expect(noteStatus(note, '2026-11-21')).toBe('Lewat target')
  })
  it('completed takes precedence over overdue', () => {
    expect(noteStatus({ ...note, completed_at: '2026-11-18T00:00:00Z' }, '2026-11-21')).toBe('Selesai')
  })
  it('formats date-only targets without a timezone day shift', () => {
    expect(noteDate('2026-11-17')).toBe('17 Nov 2026')
  })
})
