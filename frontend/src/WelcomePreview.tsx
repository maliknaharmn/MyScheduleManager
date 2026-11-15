import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import './welcome-preview.css'

type SampleEvent = {
  start: string
  end: string
  title: string
  detail: string
}

type SampleNote = {
  title: string
  tasks: string[]
  completed: boolean[]
}

type SampleDay = {
  events: SampleEvent[]
  note?: SampleNote
}

type CapacityLevel = 'Free' | 'Light' | 'Medium' | 'Busy'

const WEEKDAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const WEEKDAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const WEEK_DAYS = [16, 17, 18, 19, 20, 21, 22]
const EMPTY_DAY: SampleDay = { events: [] }

// Public illustration only. Both previews derive their figures from these rows.
const SAMPLE_DAYS: Record<number, SampleDay> = {
  14: {
    events: [
      { start: '09.00', end: '11.00', title: 'Tinjau dokumen', detail: 'Finalisasi draft' },
      { start: '14.00', end: '16.00', title: 'Belajar', detail: 'Kursus online' },
    ],
    note: { title: 'Rapikan catatan minggu ini', tasks: ['Pilih prioritas', 'Susun bahan'], completed: [false, false] },
  },
  16: {
    events: [
      { start: '09.00', end: '12.00', title: 'Kerja fokus', detail: 'Pengembangan proyek' },
      { start: '13.00', end: '16.00', title: 'Rapat dan review', detail: 'Sinkronisasi tim' },
    ],
    note: { title: 'Selesaikan daftar tugas ini', tasks: ['Riset referensi', 'Susun outline', 'Desain slide'], completed: [true, false, false] },
  },
  17: {
    events: [
      { start: '09.00', end: '11.00', title: 'Tinjau dokumen', detail: 'Finalisasi draft' },
      { start: '14.00', end: '15.00', title: 'Belajar', detail: 'Kursus online' },
    ],
    note: { title: 'Susun outline minggu ini', tasks: ['Kumpulkan ide', 'Buat kerangka'], completed: [false, false] },
  },
  18: {
    events: [
      { start: '08.00', end: '12.00', title: 'Diskusi klien', detail: 'Pembahasan kebutuhan' },
      { start: '13.00', end: '17.00', title: 'Pekerjaan mendalam', detail: 'Tanpa distraksi' },
    ],
    note: { title: 'Rencana rapat', tasks: ['Agenda diskusi', 'Materi pendukung', 'Kirim ringkasan'], completed: [true, true, false] },
  },
  19: {
    events: [
      { start: '09.00', end: '12.00', title: 'Perencanaan proyek', detail: 'Tinjau target dan prioritas' },
      { start: '14.00', end: '16.00', title: 'Kerja fokus', detail: 'Lanjutan proyek' },
    ],
  },
  20: {
    events: [
      { start: '07.00', end: '12.00', title: 'Rapat koordinasi', detail: 'Tim lintas departemen' },
      { start: '13.00', end: '19.00', title: 'Penyusunan materi', detail: 'Persiapan presentasi' },
    ],
    note: { title: 'Persiapan presentasi', tasks: ['Tinjau data', 'Latihan bicara'], completed: [true, false] },
  },
  21: {
    events: [{ start: '10.00', end: '12.00', title: 'Waktu pribadi', detail: 'Istirahat dan kegiatan favorit' }],
  },
  22: {
    events: [
      { start: '09.00', end: '11.00', title: 'Baca buku', detail: 'Pengembangan diri' },
      { start: '15.00', end: '17.00', title: 'Refleksi mingguan', detail: 'Evaluasi dan rencana berikutnya' },
    ],
    note: { title: 'Refleksi mingguan', tasks: ['Catat hal baik', 'Rencanakan minggu depan'], completed: [false, false] },
  },
}

const FIRST_DAY_OFFSET = (new Date(Date.UTC(2026, 10, 1)).getUTCDay() + 6) % 7
const CALENDAR_CELLS: (number | null)[] = [
  ...Array<null>(FIRST_DAY_OFFSET).fill(null),
  ...Array.from({ length: 30 }, (_, index) => index + 1),
]
while (CALENDAR_CELLS.length % 7) CALENDAR_CELLS.push(null)

function sampleDay(day: number): SampleDay {
  return SAMPLE_DAYS[day] ?? EMPTY_DAY
}

function dateLabel(day: number): string {
  const weekday = WEEKDAYS[new Date(Date.UTC(2026, 10, day)).getUTCDay()]
  return `${weekday}, ${day} November 2026`
}

function shortDate(day: number): string {
  const weekday = WEEKDAYS_SHORT[new Date(Date.UTC(2026, 10, day)).getUTCDay()]
  return `${weekday}, ${day} Nov`
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split('.').map(Number)
  return hours * 60 + minutes
}

function occupiedMinutes(events: SampleEvent[]): number {
  const ranges = events.map(event => [toMinutes(event.start), toMinutes(event.end)] as const).sort((a, b) => a[0] - b[0])
  let total = 0
  let currentStart = -1
  let currentEnd = -1
  for (const [start, end] of ranges) {
    if (start > currentEnd) {
      if (currentStart >= 0) total += currentEnd - currentStart
      currentStart = start
      currentEnd = end
    } else {
      currentEnd = Math.max(currentEnd, end)
    }
  }
  if (currentStart >= 0) total += currentEnd - currentStart
  return total
}

function capacityLevel(minutes: number): CapacityLevel {
  if (minutes === 0) return 'Free'
  if (minutes < 360) return 'Light'
  if (minutes <= 600) return 'Medium'
  return 'Busy'
}

function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} jam`
  if (minutes < 60) return `${minutes} menit`
  return `${Math.floor(minutes / 60)} jam ${minutes % 60} menit`
}

function capacityDescription(level: CapacityLevel): string {
  if (level === 'Free') return 'Belum ada waktu terisi pada contoh tanggal ini.'
  if (level === 'Light') return 'Masih banyak ruang untuk rencana lain.'
  if (level === 'Medium') return 'Masih ada ruang untuk fokus.'
  return 'Tanggal ini cukup padat. Pilih prioritas utama.'
}

function loadStyle(minutes: number): CSSProperties {
  return { '--welcome-load': `${Math.min(minutes / 720, 1) * 100}%` } as CSSProperties
}

function SampleEvents({ events }: { events: SampleEvent[] }) {
  if (!events.length) return <p className="welcome-sample-empty">Belum ada agenda pada contoh tanggal ini.</p>
  return <ul className="welcome-sample-events">
    {events.map(event => <li key={`${event.start}-${event.title}`}>
      <time>{event.start} - {event.end}</time>
      <span><strong>{event.title}</strong><small>{event.detail}</small></span>
    </li>)}
  </ul>
}

export function WelcomeCalendarPreview({ staticPage = false }: { staticPage?: boolean }) {
  const [selectedDay, setSelectedDay] = useState(16)
  const [hasSelected, setHasSelected] = useState(false)
  const [checkedByDay, setCheckedByDay] = useState<Record<number, boolean[]>>({})
  const [announcement, setAnnouncement] = useState('')
  const data = sampleDay(selectedDay)
  const minutes = occupiedMinutes(data.events)
  const level = capacityLevel(minutes)
  const note = data.note
  const checks = note ? checkedByDay[selectedDay] ?? note.completed : []
  const completed = checks.filter(Boolean).length

  function chooseDay(day: number) {
    setSelectedDay(day)
    setHasSelected(true)
    const next = sampleDay(day)
    setAnnouncement(`${dateLabel(day)}: ${durationLabel(occupiedMinutes(next.events))} diketahui, ${next.events.length} agenda.`)
  }

  function toggleTask(index: number, checked: boolean) {
    if (!note) return
    const next = checks.map((value, taskIndex) => taskIndex === index ? checked : value)
    setCheckedByDay(previous => ({ ...previous, [selectedDay]: next }))
    setAnnouncement(`Checklist contoh: ${next.filter(Boolean).length} dari ${next.length} selesai.`)
  }

  return <figure className="welcome-calendar-demo" aria-labelledby="welcome-calendar-title" data-ui>
    <div className="welcome-calendar-frame">
      <div className="welcome-calendar-top"><h2 id="welcome-calendar-title">Kalender hidup</h2><span>Data ilustrasi</span></div>
      <div className="welcome-calendar-grid">
        <div className="welcome-calendar-month">
          <div className="welcome-calendar-month-heading"><h3>November 2026</h3><span>Senin - Minggu</span></div>
          <div className="welcome-calendar-weekdays" aria-hidden="true">{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(day => <span key={day}>{day}</span>)}</div>
          <div className="welcome-calendar-days" role="group" aria-label="Pilih tanggal di November 2026">
            {CALENDAR_CELLS.map((day, index) => day === null
              ? <span className="welcome-calendar-blank" aria-hidden="true" key={`blank-${index}`} />
              : <button type="button" key={day} className="welcome-calendar-day" data-has-agenda={sampleDay(day).events.length > 0} aria-label={dateLabel(day)} aria-pressed={day === selectedDay} disabled={staticPage} onClick={() => chooseDay(day)}>{day}</button>)}
          </div>
          <p className="welcome-calendar-hint">Tanggal bertanda memiliki contoh agenda. Pilih tanggal lain untuk melihat hari kosong.</p>
        </div>
        <div className="welcome-calendar-detail" id="welcome-month-detail">
          <p className="welcome-calendar-selected">{dateLabel(selectedDay)}</p>
          <div className={`welcome-calendar-detail-content${hasSelected ? ' is-swapping' : ''}`} key={selectedDay}>
            <div className="welcome-calendar-capacity" style={loadStyle(minutes)}>
              <span className="welcome-calendar-ring"><span>{durationLabel(minutes)}</span></span>
              <div><strong>{level}</strong><p>{capacityDescription(level)}</p></div>
            </div>
            <div className="welcome-calendar-agenda-heading"><h3>Agenda tanggal ini</h3><span>{data.events.length} agenda</span></div>
            <SampleEvents events={data.events} />
            <div className="welcome-calendar-note">
              <div className="welcome-calendar-note-heading"><h3>Catatan penting</h3>{note && <span>{completed} dari {note.tasks.length} selesai</span>}</div>
              {note ? <>
                <p className="welcome-calendar-note-title">{note.title}</p>
                <div className="welcome-calendar-progress" role="progressbar" aria-label="Progres checklist contoh" aria-valuemin={0} aria-valuemax={note.tasks.length} aria-valuenow={completed}><span style={{ width: `${completed / note.tasks.length * 100}%` }} /></div>
                <div className="welcome-calendar-checklist">{note.tasks.map((task, index) => <label key={task}><input type="checkbox" checked={checks[index]} disabled={staticPage} onChange={event => toggleTask(index, event.target.checked)} /><span>{task}</span></label>)}</div>
              </> : <p className="welcome-calendar-note-empty">Belum ada catatan penting pada contoh tanggal ini.</p>}
            </div>
          </div>
          <span className="sr-only" aria-live="polite">{announcement}</span>
        </div>
      </div>
    </div>
    <figcaption>Contoh tampilan dengan data ilustrasi.</figcaption>
  </figure>
}

export function WelcomeWeekPreview({ staticPage = false }: { staticPage?: boolean }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [hasSelected, setHasSelected] = useState(false)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [announcement, setAnnouncement] = useState('')
  const selectedDay = WEEK_DAYS[selectedIndex]
  const data = sampleDay(selectedDay)
  const minutes = occupiedMinutes(data.events)
  const level = capacityLevel(minutes)

  function selectIndex(index: number, focus = false) {
    const nextIndex = (index + WEEK_DAYS.length) % WEEK_DAYS.length
    setSelectedIndex(nextIndex)
    setHasSelected(true)
    const nextDay = WEEK_DAYS[nextIndex]
    setAnnouncement(`${dateLabel(nextDay)}: ${capacityLevel(occupiedMinutes(sampleDay(nextDay).events))}, ${durationLabel(occupiedMinutes(sampleDay(nextDay).events))} diketahui.`)
    if (focus) tabRefs.current[nextIndex]?.focus()
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number
    if (event.key === 'ArrowRight') nextIndex = index + 1
    else if (event.key === 'ArrowLeft') nextIndex = index - 1
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = WEEK_DAYS.length - 1
    else return
    event.preventDefault()
    selectIndex(nextIndex, true)
  }

  return <section className="welcome-week-section" aria-labelledby="welcome-week-title">
    <div className="welcome-week-intro"><div><h2 id="welcome-week-title">Agenda Mingguan</h2><p className="welcome-week-caption">Coba jelajahi satu minggu</p></div><p>Pilih hari untuk melihat bagaimana agenda dan kapasitas berubah sepanjang minggu.</p></div>
    <div className="welcome-week-demo" data-ui>
      <div className="welcome-week-top"><div><strong>16 - 22 Nov 2026</strong><span>Rencana dalam satu pandangan</span></div><div className="welcome-week-controls"><span>Data ilustrasi</span><button type="button" aria-label="Hari sebelumnya" disabled={staticPage} onClick={() => selectIndex(selectedIndex - 1)}><ChevronLeft size={19} aria-hidden /></button><button type="button" aria-label="Hari berikutnya" disabled={staticPage} onClick={() => selectIndex(selectedIndex + 1)}><ChevronRight size={19} aria-hidden /></button></div></div>
      <div className="welcome-week-tabs" role="tablist" aria-label="Pilih tanggal contoh">
        {WEEK_DAYS.map((day, index) => {
          const dayMinutes = occupiedMinutes(sampleDay(day).events)
          return <button key={day} id={`welcome-week-tab-${day}`} ref={element => { tabRefs.current[index] = element }} type="button" role="tab" aria-label={dateLabel(day)} aria-controls="welcome-week-detail" aria-selected={index === selectedIndex} tabIndex={index === selectedIndex ? 0 : -1} disabled={staticPage} onClick={() => selectIndex(index)} onKeyDown={event => onTabKeyDown(event, index)} style={loadStyle(dayMinutes)}>
            <span>{WEEKDAYS_SHORT[new Date(Date.UTC(2026, 10, day)).getUTCDay()]}</span><strong>{day}</strong><i aria-hidden="true"><i /></i>
          </button>
        })}
      </div>
      <div className="welcome-week-detail" id="welcome-week-detail" role="tabpanel" aria-labelledby={`welcome-week-tab-${selectedDay}`} tabIndex={0}>
        <div className={`welcome-week-detail-content${hasSelected ? ' is-swapping' : ''}`} key={selectedDay}>
          <div className="welcome-week-capacity" style={loadStyle(minutes)}><p>Kapasitas {shortDate(selectedDay)}</p><div><span className="welcome-week-ring"><span>{durationLabel(minutes)}<small>diketahui</small></span></span><span className="welcome-week-reading"><strong>{level}</strong><small>{capacityDescription(level)}</small></span></div><p>{data.events.length} agenda pada tanggal ini</p></div>
          <div className="welcome-week-agenda"><div><h3>{dateLabel(selectedDay)}</h3><span>{data.events.length} agenda</span></div><SampleEvents events={data.events} /></div>
        </div>
      </div>
      <p className="welcome-week-footnote">Pratinjau ini memakai data ilustrasi. Pilihan tanggal tidak disimpan.</p>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </div>
  </section>
}
