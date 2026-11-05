import { mondayOf } from '../src/calendar-date'

export function overviewRange(url: URL) {
  const month = url.searchParams.get('month_start')
  return {
    month,
    start: month ? mondayOf(month) : url.searchParams.get('week_start')!,
    days: month ? 42 : Number(url.searchParams.get('weeks') ?? 1) * 7,
    metadata: month ? { month_start: month } : {},
  }
}
