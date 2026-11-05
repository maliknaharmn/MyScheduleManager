import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Me } from './api/client'
import type { WeekOverview } from './api/resources'
import { addDays, changeMonth, formatDay, localIso, mondayOf, monthDates, monthOf, shiftMonthDate } from './calendar-date'
import { splitWeeks, useMonth } from './week-cache'

type Props = {
  me: Me; today: string; selectedDate: string; week: WeekOverview | undefined;
  weekFailed: boolean; onSelect: (date: string) => void;
}
const weekdays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

export function HomeCalendar({ me, today, selectedDate, week, weekFailed, onSelect }: Props) {
  const client = useQueryClient()
  const [browsing, setBrowsing] = useState({ selection: selectedDate, month: monthOf(selectedDate) })
  const month = browsing.selection === selectedDate ? browsing.month : monthOf(selectedDate)
  const dates = monthDates(month)
  const [focusedDate, setFocusedDate] = useState(selectedDate)
  const pendingFocus = useRef<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  // The foreground week/capacity renders first; month markers never hold it up.
  const overview = useMonth(me, month, !!week)
  const byDate = new Map(overview.data?.days.map(day => [day.date, day]))
  for (const day of week?.days ?? []) byDate.set(day.date, day)
  const tabDate = dates.includes(focusedDate) ? focusedDate : dates.includes(selectedDate) ? selectedDate : month
  const summaryDate = monthOf(selectedDate) === month ? selectedDate === today ? addDays(today, 1) : selectedDate : month
  const summary = byDate.get(summaryDate)
  const summaryPrefix = summaryDate === today ? 'Hari ini · ' : summaryDate === addDays(today, 1) ? 'Besok · ' : summaryDate < today ? 'Riwayat · ' : ''
  const showMonth = (next: string) => setBrowsing({ selection: selectedDate, month: next })
  const select = (date: string) => {
    // A just-loaded month can serve a chosen historical week immediately. Never
    // replace a foreground read/newer result or persist month data without consent.
    if (overview.data && !overview.isError && overview.dataUpdatedAt >= Date.now() - 60_000) {
      const cached = splitWeeks(overview.data).find(value => value.week_start === mondayOf(date))
      const key = ['week', me.user.id, me.profile.timezone, mondayOf(date)]
      const state = client.getQueryState(key)
      if (cached && state?.fetchStatus !== 'fetching' && (!state?.data || state.isInvalidated || state.dataUpdatedAt < overview.dataUpdatedAt)) {
        client.setQueryData(key, cached, { updatedAt: overview.dataUpdatedAt })
      }
    }
    pendingFocus.current = monthOf(date) !== month ? date : null
    setFocusedDate(date)
    onSelect(date)
  }
  useEffect(() => {
    if (pendingFocus.current) {
      buttons.current.get(pendingFocus.current)?.focus()
      pendingFocus.current = null
    }
  }, [month, focusedDate])
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    let next: string
    switch (event.key) {
      case 'ArrowLeft': next = addDays(date, -1); break
      case 'ArrowRight': next = addDays(date, 1); break
      case 'ArrowUp': next = addDays(date, -7); break
      case 'ArrowDown': next = addDays(date, 7); break
      case 'Home': next = mondayOf(date); break
      case 'End': next = addDays(mondayOf(date), 6); break
      case 'PageUp': next = shiftMonthDate(date, event.shiftKey ? -12 : -1); break
      case 'PageDown': next = shiftMonthDate(date, event.shiftKey ? 12 : 1); break
      default: return
    }
    event.preventDefault()
    if (next < '0001-01-01' || next > '9998-12-31') return
    if (next < dates[0] || next > dates[41] || event.key.startsWith('Page')) showMonth(monthOf(next))
    pendingFocus.current = next
    setFocusedDate(next)
  }
  const summaryLabel = `${summaryPrefix}${formatDay(summaryDate, { weekday: 'short', day: 'numeric', month: 'short' })}`
  return <section className="app-calendar" aria-labelledby="home-calendar-title">
    <div className="app-calendar-heading">
      <div><h2 id="home-calendar-title">Kalender</h2><time id="calendar-month-label" dateTime={month} aria-live="polite">{formatDay(month, { month: 'long', year: 'numeric' })}</time></div>
      <div className="app-calendar-controls">
        <button aria-label="Bulan sebelumnya" disabled={month <= '0001-01-01'} onClick={() => showMonth(changeMonth(month, -1))}><ChevronLeft size={18} aria-hidden /></button>
        <button aria-label="Bulan berikutnya" disabled={month >= '9998-12-01'} onClick={() => showMonth(changeMonth(month, 1))}><ChevronRight size={18} aria-hidden /></button>
      </div>
    </div>
    <div role="grid" aria-labelledby="calendar-month-label" className="app-calendar-grid" aria-busy={overview.isFetching}>
      <div role="row" className="app-calendar-weekdays">{weekdays.map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, index) => <div role="row" className="app-calendar-week" key={index}>{dates.slice(index * 7, index * 7 + 7).map(date => {
        const day = byDate.get(date)
        return <div role="gridcell" aria-selected={date === selectedDate} key={date}>
          <button ref={node => { if (node) buttons.current.set(date, node); else buttons.current.delete(date) }}
            className={`app-calendar-date${monthOf(date) !== month ? ' outside' : ''}`}
            tabIndex={date === tabDate ? 0 : -1} aria-current={date === today ? 'date' : undefined}
            aria-pressed={date === selectedDate} aria-label={`Pilih ${formatDay(date, { dateStyle: 'full' })}${day ? `, ${day.occurrence_count} agenda` : ''}`}
            onFocus={() => setFocusedDate(date)} onKeyDown={event => moveFocus(event, date)} onClick={() => select(date)}>
            <span>{Number(date.slice(-2))}</span><i aria-hidden className={day?.occurrence_count ? 'has-agenda' : ''} />
          </button>
        </div>
      })}</div>)}
    </div>
    <div className="app-calendar-summary" aria-label="Ringkasan agenda kalender">
      <div className="app-calendar-summary-heading"><Link to={`/day/${summaryDate}`} aria-label={`Lihat agenda ${formatDay(summaryDate, { dateStyle: 'full' })}`}><strong>{summaryLabel}</strong>{summary && <span>{summary.occurrence_count} agenda</span>}</Link></div>
      {summary ? <>
        {summary.occurrences.length ? <ul>{summary.occurrences.slice(0, 2).map(item => <li key={item.occurrence_key}><Link to={`/agenda/${item.schedule_id}`}>
          <time>{item.starts_at ? localIso(item.starts_at, me.profile.timezone) < summaryDate ? 'Lanjutan' : new Intl.DateTimeFormat('id-ID', { timeZone: me.profile.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.starts_at)) : 'Tanpa jam'}</time>{item.title}
        </Link></li>)}</ul> : <p>Belum ada agenda pada tanggal ini.</p>}
        {summary.occurrence_count > 2 && <Link className="app-calendar-more" to={`/day/${summaryDate}`}>Lihat {summary.occurrence_count - 2} agenda lainnya</Link>}
      </> : <p role="status">{overview.isError || weekFailed ? 'Ringkasan belum tersedia.' : 'Memuat ringkasan…'}</p>}
    </div>
    {overview.isError ? <div className="app-calendar-feedback"><p role="alert">{overview.data ? 'Kalender belum dapat diperbarui.' : 'Penanda kalender belum dapat dimuat.'}</p><button onClick={() => void overview.refetch()}>Coba lagi</button></div>
      : !overview.data && <p className="app-calendar-feedback" role="status">{weekFailed ? 'Kalender menunggu data agenda.' : 'Memuat penanda agenda…'}</p>}
    {overview.isFetching && overview.data && <p className="app-calendar-feedback" role="status">Memperbarui kalender…</p>}
    {(month !== monthOf(today) || selectedDate !== today) && <button className="app-calendar-today" onClick={() => { showMonth(monthOf(today)); select(today) }}>Hari ini</button>}
  </section>
}
