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
