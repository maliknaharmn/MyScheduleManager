import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, BookOpen, BriefcaseBusiness, CalendarDays,
  Check, ChevronLeft, ChevronRight, FileText,
  Heart, House, ListTodo, Pencil, Plus, Search, Settings2, Star, Trash2, Users,
} from 'lucide-react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { api, ApiError } from './api/client'
import type { Me } from './api/client'
import type { CapacityDay, CapacityLevel, ListResult, Note, Occurrence, Schedule, Tag, WeekOverview } from './api/resources'
import { clockMinutes, endAfter, suggestedStart } from './agenda-time'
import { ThemeSwitch } from './theme'
import { agendaChanged, useCalendarTabSync, useWeek } from './week-cache'
import { PageHeading } from './components/PageHeading'
import { NotesList, NoteForm, NoteEditor, NoteDetailScreen } from './NotesWorkspace'

type ShellProps = { me: Me; settings: ReactNode; logout: () => void; logoutPending: boolean; logoutError: string }

function dayDate(iso: string) { return new Date(`${iso}T12:00:00Z`) }
function dateIso(value: Date) { return value.toISOString().slice(0, 10) }
function validIso(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = dayDate(value)
  return !Number.isNaN(parsed.getTime()) && dateIso(parsed) === value
}
function addDays(iso: string, amount: number) {
  const value = dayDate(iso)
  value.setUTCDate(value.getUTCDate() + amount)
  return dateIso(value)
}
function todayInZone(zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function mondayOf(iso: string) { return addDays(iso, -((dayDate(iso).getUTCDay() + 6) % 7)) }
function formatDay(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', ...options }).format(dayDate(iso))
}
function localIso(timestamp: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function formatTime(timestamp: string, zone: string) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp))
}
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours} jam${remainder ? ` ${remainder} menit` : ''}` : `${remainder} menit`
}
function timeLabel(item: Occurrence, day: string, zone: string) {
  if (!item.starts_at || !item.ends_at) return 'Tanpa jam'
  const first = localIso(item.starts_at, zone)
  const last = localIso(item.ends_at, zone)
  if (first < day) return `Berlanjut hingga ${formatTime(item.ends_at, zone)}`
  if (last > day) return `${formatTime(item.starts_at, zone)} → besok`
  return `${formatTime(item.starts_at, zone)}–${formatTime(item.ends_at, zone)}`
}
function categoryIcon(category: string) {
  switch (category) {
    case 'Work': case 'Business': return BriefcaseBusiness
    case 'Academic': return BookOpen
    case 'Organization': case 'Social': return Users
    case 'Personal': return Heart
    default: return CalendarDays
  }
}
const categories = [
  ['Work', 'Kerja'], ['Academic', 'Akademik'], ['Business', 'Bisnis'],
  ['Organization', 'Organisasi'], ['Personal', 'Pribadi'], ['Social', 'Sosial'], ['Other', 'Lainnya'],
] as const
function categoryName(category: string) { return categories.find(([value]) => value === category)?.[1] ?? category }
const tagsQuery = { queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags'), staleTime: 60_000 }

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const location = useLocation()
  const selectedDate = location.pathname === '/' ? new URLSearchParams(location.search).get('date') : null
  const addHref = selectedDate ? `/agenda/new?date=${selectedDate}` : '/agenda/new'
  const links = [
    { to: '/', label: 'Home', icon: House },
    { to: '/agenda', label: 'Agenda', icon: CalendarDays },
    { to: '/notes', label: 'Catatan', icon: FileText },
    { to: '/settings', label: 'Pengaturan', icon: Settings2 },
  ]
  return <nav aria-label="Navigasi utama" className={mobile ? 'app-nav-mobile' : 'app-nav-desktop'}>
    {links.slice(0, 2).map(({ to, label, icon: Icon }) =>
      <NavLink key={to} to={to} end={to === '/'}><Icon aria-hidden size={20} /><span>{label}</span></NavLink>)}
    {mobile && <Link className="app-nav-add" to={addHref} aria-label="Tambah agenda"><Plus aria-hidden size={23} /><span>Agenda</span></Link>}
    {links.slice(2).map(({ to, label, icon: Icon }) =>
      <NavLink key={to} to={to}><Icon aria-hidden size={20} /><span>{label}</span></NavLink>)}
    <ThemeSwitch compact={mobile} />
  </nav>
}

function Shell({ me, settings, logout, logoutPending, logoutError }: ShellProps) {
  useCalendarTabSync()
  const location = useLocation()
  const selectedDate = location.pathname === '/' ? new URLSearchParams(location.search).get('date') : null
  const addHref = selectedDate ? `/agenda/new?date=${selectedDate}` : '/agenda/new'
  return <div className="app-shell">
    <aside className="app-sidebar">
      <Link className="app-brand" to="/"><span className="app-brand-mark"><img src="/icons/icon-192.png" alt="" /></span><span>MySchedule</span></Link>
      <Navigation />
      <Link className="app-sidebar-add" to={addHref}><Plus size={19} aria-hidden />Tambah agenda</Link>
      <p className="app-sidebar-foot">Ruang pribadi · {me.profile.timezone}</p>
    </aside>
    <main className="app-main">
      {logoutError && <p role="alert" className="app-alert">{logoutError}</p>}
      <Routes>
        <Route path="/" element={<Home me={me} />} />
        <Route path="/day/:date" element={<DayScreen me={me} />} />
        <Route path="/agenda" element={<AgendaList />} />
        <Route path="/agenda/new" element={<AgendaForm me={me} />} />
        <Route path="/agenda/:id" element={<AgendaDetail me={me} />} />
        <Route path="/agenda/:id/edit" element={<AgendaEditor me={me} />} />
        <Route path="/notes" element={<NotesList me={me} />} />
        <Route path="/notes/new" element={<NoteForm me={me} />} />
        <Route path="/notes/:id" element={<NoteDetailScreen me={me} />} />
        <Route path="/notes/:id/edit" element={<NoteEditor me={me} />} />
        <Route path="/settings" element={<div className="app-settings"><div className="app-page-heading"><div><h1>Pengaturan</h1><p>Akun dan preferensi pribadimu.</p></div><button className="app-secondary" onClick={logout} disabled={logoutPending}>Keluar</button></div>{settings}</div>} />
        <Route path="*" element={<div className="app-empty"><h1>Halaman tidak ditemukan</h1><Link to="/">Kembali ke Home</Link></div>} />
      </Routes>
    </main>
    <Navigation mobile />
  </div>
}

function CapacityCard({ day, selectedDate, failed }: { day: CapacityDay | undefined; selectedDate: string; failed: boolean }) {
  if (!day) return <section className="app-capacity-card app-capacity-loading" aria-label={failed ? 'Kapasitas belum tersedia' : 'Kapasitas sedang dimuat'}><span>{failed ? 'Kapasitas belum tersedia' : 'Memuat kapasitas…'}</span></section>
  return <Link to={`/day/${selectedDate}`} className="app-capacity-card" aria-label={`Lihat detail kapasitas ${formatDay(selectedDate, { dateStyle: 'full' })}`}>
    <div className="app-card-top"><h2>Kapasitas tanggal ini</h2><ChevronRight size={21} aria-hidden /></div>
    <div className="app-capacity-middle">
      <div className="app-capacity-disc"><strong>{duration(day.known_scheduled_minutes)}</strong><span>diketahui</span></div>
      <div className="app-capacity-reading"><strong>{day.is_partial ? `${day.level} sementara` : day.level}</strong><span>{day.is_partial ? `${day.unknown_duration_count} agenda tanpa durasi` : day.known_scheduled_minutes === 0 ? 'Belum ada jam terisi di aplikasi' : `${day.occurrence_count} agenda pada tanggal ini`}</span></div>
    </div>
    <div className="app-levels" aria-label="Tingkat kapasitas">
      {(['Free', 'Light', 'Medium', 'Busy'] as CapacityLevel[]).map((level) =>
        <span key={level} className={day.level === level ? 'current' : ''}>{level}</span>)}
    </div>
  </Link>
}

function ImportantNote({ note }: { note: Note | undefined }) {
  return <section className="app-note-feature">
    <div className="app-note-heading"><span className="app-star"><Star size={17} fill="currentColor" aria-hidden /></span><h2>Catatan penting</h2><Link to={note ? `/notes/${note.id}` : '/notes/new'} aria-label={note ? 'Buka catatan penting' : 'Tambah catatan penting'}><ChevronRight aria-hidden size={21} /></Link></div>
    {note ? <>
      <Link className="app-note-title" to={`/notes/${note.id}`}>{note.title}</Link>
      <div className="app-progress" role="progressbar" aria-label="Progress checklist" aria-valuenow={note.completed_items} aria-valuemin={0} aria-valuemax={note.total_items || 1}><span style={{ width: `${note.total_items ? (note.completed_items / note.total_items) * 100 : 0}%` }} /></div>
      <p>{note.total_items ? `${note.completed_items} dari ${note.total_items} selesai` : 'Belum ada checklist'}</p>
      <ul>{note.checklist.slice(0, 3).map((item) => <li key={item.id}><span className={item.completed_at ? 'done' : 'todo'}>{item.completed_at && <Check size={12} aria-hidden />}</span>{item.title}</li>)}</ul>
      {note.reminder_status === 'needs_connection' && <p className="app-reminder-caution">Pengingat belum aktif · hubungkan Calendar nanti</p>}
    </> : <div className="app-note-none"><p>Belum ada catatan Important.</p><Link to="/notes/new">Tambah catatan <ArrowRight size={15} aria-hidden /></Link></div>}
  </section>
}

function WeekRows({ week, selectedDate, onSelect, failed = false }: { week: WeekOverview | undefined; selectedDate?: string; onSelect?: (date: string) => void; failed?: boolean }) {
  if (!week) return <div className="app-week-loading" role="status">{failed ? 'Agenda belum tersedia.' : 'Memuat agenda minggu…'}</div>
  return <div className="app-week-rows">{week.days.map((day) => {
    const dayText = formatDay(day.date, { weekday: 'short' })
    return <div className={`app-day-row ${day.date === selectedDate ? 'selected' : ''}`} key={day.date}>
      {onSelect ? <button className="app-day-date" onClick={() => onSelect(day.date)} aria-label={`Pilih ${formatDay(day.date, { dateStyle: 'full' })}`}><span>{dayText}</span><strong>{day.date.slice(-2)}</strong><small>{formatDay(day.date, { month: 'short' })}</small></button>
        : <Link className="app-day-date" to={`/day/${day.date}`}><span>{dayText}</span><strong>{day.date.slice(-2)}</strong><small>{formatDay(day.date, { month: 'short' })}</small></Link>}
      <div className="app-day-events">{day.occurrences.length ? day.occurrences.map((item) => {
        const Icon = categoryIcon(item.category)
        return <Link className="app-event" to={`/agenda/${item.schedule_id}`} key={item.occurrence_key}>
          <span className="app-event-line" aria-hidden />
          <time>{timeLabel(item, day.date, week.timezone)}</time>
          <span className="app-event-text"><strong>{item.is_important && <Star size={13} fill="currentColor" aria-label="Important" />} {item.title}</strong><small>{categoryName(item.category)}{item.status === 'Tentative' ? ' · Tentative' : ''}</small></span>
          <span className="app-event-icon"><Icon size={19} aria-hidden /></span>
        </Link>
      }) : <div className="app-day-empty"><span>Belum ada agenda</span><span className="app-day-level">{day.is_partial ? 'Durasi belum lengkap' : day.level}</span></div>}</div>
    </div>
  })}</div>
}

function Home({ me }: { me: Me }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = todayInZone(me.profile.timezone)
  const requestedWeek = params.get('week')
  const weekStart = validIso(requestedWeek) ? mondayOf(requestedWeek) : mondayOf(today)
  const requestedDate = params.get('date')
  const selectedDate = validIso(requestedDate) && requestedDate >= weekStart && requestedDate <= addDays(weekStart, 6)
    ? requestedDate : weekStart === mondayOf(today) ? today : weekStart
  const overview = useWeek(me, weekStart)
  const notes = useQuery({ queryKey: ['notes', 'open'], queryFn: ({ signal }) => api<ListResult<Note>>('/notes?completion=open&limit=100', { signal }) })
  const selected = overview.data?.days.find((day) => day.date === selectedDate)
  const important = notes.data?.items.find((note) => note.is_important)
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: me.profile.timezone, hour: '2-digit', hour12: false }).format(new Date()))
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam'
  const setSelected = (date: string) => setParams({ week: weekStart, date })
  const changeWeek = (amount: number) => {
    const next = addDays(weekStart, amount * 7)
    setParams({ week: next, date: next })
  }
  return <div className="app-home">
    <header className="app-home-header">
      <div><p className="app-greeting">{greeting}{me.user.display_name?.trim() ? `, ${me.user.display_name.trim()}` : ''}</p><h1>{formatDay(selectedDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</h1><span>Hari yang terencana, langkah lebih ringan.</span></div>
      <div className="app-header-actions"><button onClick={() => navigate('/agenda?focus=search')} aria-label="Cari agenda"><Search size={22} aria-hidden /></button><Link to="/notes" aria-label="Buka catatan"><ListTodo size={22} aria-hidden /></Link></div>
    </header>
    <div className="app-home-top">
      <CapacityCard day={selected} selectedDate={selectedDate} failed={overview.isError} />
      {notes.isPending ? <section className="app-note-feature" role="status"><h2>Catatan penting</h2><p>Memuat catatan…</p></section> : notes.isError ? <section className="app-note-feature"><h2>Catatan penting</h2><p role="alert">Catatan belum dapat dimuat.</p><button onClick={() => void notes.refetch()}>Coba lagi</button></section> : <ImportantNote note={important} />}
    </div>
    {overview.isError && <div className="app-alert" role="alert">{overview.data ? 'Menampilkan cache terakhir. Pembaruan agenda belum berhasil.' : 'Kapasitas dan agenda belum dapat dimuat.'} <button onClick={() => void overview.refetch()}>Coba lagi</button></div>}
    <section className="app-week-panel">
      <div className="app-section-heading"><h2>Agenda Mingguan</h2><div className="app-week-switch"><span>{formatDay(weekStart, { day: 'numeric', month: 'short' })} – {formatDay(addDays(weekStart, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</span><button onClick={() => changeWeek(-1)} aria-label="Minggu sebelumnya"><ChevronLeft size={21} aria-hidden /></button><button onClick={() => changeWeek(1)} aria-label="Minggu berikutnya"><ChevronRight size={21} aria-hidden /></button></div></div>
      {overview.isFetching && overview.data && <p className="app-cache-status" role="status">Menampilkan cache · memperbarui…</p>}
      <WeekRows week={overview.data} selectedDate={selectedDate} onSelect={setSelected} failed={overview.isError} />
      <div className="app-week-footer"><span>{overview.data ? `${overview.data.days.reduce((sum, day) => sum + day.occurrence_count, 0)} tampilan agenda dalam minggu ini` : overview.isError ? 'Data agenda belum tersedia' : 'Data agenda sedang dimuat'}</span><Link to="/agenda">Lihat semua agenda <ArrowRight size={16} aria-hidden /></Link></div>
    </section>
    <section className="app-notes-teaser"><div className="app-teaser-icon"><FileText size={22} aria-hidden /></div><div><h2>Catatan belum selesai</h2><p>{notes.data?.items.length ? `${notes.data.items.length} catatan perlu dipantau` : 'Target, checklist, dan prasyarat tersimpan terpisah dari agenda.'}</p></div><Link to="/notes" aria-label="Lihat semua catatan"><ChevronRight size={20} aria-hidden /></Link></section>
    <Link to={`/agenda/new?date=${selectedDate}`} className="app-floating-add"><Plus size={21} aria-hidden />Agenda</Link>
  </div>
}

function DayScreen({ me }: { me: Me }) {
  const { date } = useParams()
  const day = validIso(date ?? null) ? date! : todayInZone(me.profile.timezone)
  const monday = mondayOf(day)
  const overview = useWeek(me, monday)
  const data = overview.data?.days.find((entry) => entry.date === day)
  return <div className="app-content-page"><PageHeading title={formatDay(day, { dateStyle: 'full' })} description="Kapasitas dihitung dari jam agenda yang diketahui." back={`/?week=${monday}&date=${day}`} action={<Link className="app-primary" to={`/agenda/new?date=${day}`}><Plus size={18} aria-hidden />Agenda</Link>} />
    {overview.isError && <div className="app-alert" role="alert">Detail hari belum dapat dimuat. <button onClick={() => void overview.refetch()}>Coba lagi</button></div>}
    {data && <><div className="app-day-summary"><strong>{data.is_partial ? `${data.level} sementara` : data.level}</strong><span>{duration(data.known_scheduled_minutes)} diketahui · {data.occurrence_count} agenda</span>{data.has_conflicts && <p>Ada agenda yang bertumpuk; jam dihitung sekali.</p>}{data.is_partial && <p>{data.unknown_duration_count} agenda tanpa durasi. Slot kosong belum pasti.</p>}</div><section className="app-list-panel"><h2>Agenda pada hari ini</h2><WeekRows week={{ ...overview.data!, days: [data] }} /></section></>}
  </div>
}

function AgendaList() {
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (params.get('focus') === 'search') searchRef.current?.focus() }, [params])
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: () => api<ListResult<Schedule>>('/schedules?limit=100') })
  const rows = (schedules.data?.items ?? []).filter((row) => row.title.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || row.status === status))
  const dateOf = (row: Schedule) => row.time.range_start ?? (row.time.starts_at ? localIso(row.time.starts_at, row.time.timezone) : '')
  rows.sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
  return <div className="app-content-page"><PageHeading title="Agenda" description="Semua komitmen yang sudah kamu catat." action={<Link className="app-primary" to="/agenda/new"><Plus size={18} aria-hidden />Agenda</Link>} />
    <div className="app-filter-bar"><label><Search size={18} aria-hidden /><span className="sr-only">Cari judul agenda</span><input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari judul agenda" /></label><select aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Semua status</option><option value="Confirmed">Confirmed</option><option value="Tentative">Tentative</option></select></div>
    {schedules.isError && <div className="app-alert" role="alert">Agenda belum dapat dimuat. <button onClick={() => void schedules.refetch()}>Coba lagi</button></div>}
    <div className="app-list-panel">{schedules.isPending ? <p>Memuat agenda…</p> : rows.length ? rows.map((row) => <Link to={`/agenda/${row.id}`} className="app-list-item" key={row.id}><div><strong>{row.tags.some((tag) => tag.system_key === 'important') && <Star size={15} fill="currentColor" aria-label="Important" />} {row.title}</strong><span>{dateOf(row) ? formatDay(dateOf(row), { dateStyle: 'medium' }) : 'Tanggal belum tersedia'} · {categoryName(row.category)} · {row.status}</span></div><ChevronRight size={19} aria-hidden /></Link>) : <div className="app-empty"><h2>{search || status !== 'all' ? 'Tidak ada hasil' : 'Belum ada agenda'}</h2><p>{search || status !== 'all' ? 'Ubah pencarian atau filter.' : 'Mulai dari satu agenda yang sudah pasti.'}</p>{!search && status === 'all' && <Link to="/agenda/new">Tambah agenda <ArrowRight size={16} aria-hidden /></Link>}</div>}</div>
    {schedules.data?.has_more && <p className="app-limited">Daftar ini menampilkan 100 agenda terbaru; pencarian di sini belum mencakup sisanya.</p>}
  </div>
}

type AgendaFields = { title: string; start: string; end: string; startTime: string; endTime: string; mode: 'timed' | 'date_only' | 'all_day' | 'interval'; overnight: boolean; category: string; status: 'Confirmed' | 'Tentative'; important: boolean; reminders: boolean; repeat: boolean; intervalStart: string; intervalEnd: string }
function AgendaForm({ me, initial, reload }: { me: Me; initial?: Schedule; reload?: () => Promise<void> }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const requestedDate = params.get('date')
  const zone = initial?.time.timezone ?? me.profile.timezone
  const day = initial?.time.range_start ?? (validIso(requestedDate) ? requestedDate : todayInZone(zone))
  const [advanced, setAdvanced] = useState(!!initial)
  const [selectedDays, setSelectedDays] = useState<number[]>(initial?.time.weekdays ?? [1, 2, 3, 4, 5, 6, 7])
  const saving = useRef(false)
  const initialStart = initial?.time.start_local_time?.slice(0, 5) ?? suggestedStart(zone, day === todayInZone(zone))
  const defaults: AgendaFields = {
    title: initial?.title ?? '', start: day, end: initial?.time.range_end ?? day,
    startTime: initialStart, ...endAfter(initialStart, 60),
    mode: initial?.time.mode === 'timed_interval' ? 'interval' : initial?.time.mode === 'date_only' || initial?.time.mode === 'all_day' ? initial.time.mode : 'timed',
    category: initial?.category ?? 'Other', status: initial?.status ?? 'Confirmed',
    important: !!initial?.tags.some((tag) => tag.system_key === 'important'),
    reminders: !!initial?.reminder_offsets_minutes.length,
    repeat: !!initial?.time.range_end && initial.time.range_end !== day,
    intervalStart: initial?.time.starts_at ?? '', intervalEnd: initial?.time.ends_at ?? '',
  }
  if (initial?.time.end_local_time) defaults.endTime = initial.time.end_local_time.slice(0, 5)
  if (initial) defaults.overnight = !!initial.time.end_day_offset
  const { register, handleSubmit, watch, getValues, setValue, formState: { errors, isDirty } } = useForm<AgendaFields>({ defaultValues: defaults })
  const mode = watch('mode')
  const start = watch('start')
  const end = watch('end')
  const repeat = watch('repeat')
  const startTime = watch('startTime')
  const endTime = watch('endTime')
  const overnight = watch('overnight')
  // Start fetching on selection, not on page entry; saving reuses/deduplicates it.
  useQuery({ ...tagsQuery, enabled: watch('important') })
  const minutes = clockMinutes(endTime) - clockMinutes(startTime) + (overnight ? 1440 : 0)
  const setDuration = (value: number, from = getValues('startTime')) => {
    if (!from) return
    const next = endAfter(from, value)
    setValue('endTime', next.endTime, { shouldDirty: true, shouldValidate: true })
    setValue('overnight', next.overnight, { shouldDirty: true })
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])
  const create = useMutation({ mutationFn: async (values: AgendaFields) => {
    // Ordinary agendas need no tags request. Important resolves it only when needed.
    const existingImportant = initial?.tags.find((tag) => tag.system_key === 'important')
    const tags = values.important && !existingImportant ? await queryClient.fetchQuery(tagsQuery) : []
    const importantTag = existingImportant ?? tags.find((tag) => tag.system_key === 'important')
    if (values.important && !importantTag) throw new Error('Tag Important belum tersedia. Coba simpan kembali.')
    const lastDate = values.repeat ? values.end : values.start
    const range = values.start !== lastDate
    const weekdays = range ? selectedDays : [((dayDate(values.start).getUTCDay() + 6) % 7) + 1]
    if (lastDate < values.start) throw new Error('Tanggal akhir harus sama atau setelah tanggal mulai.')
    if (range && !weekdays.length) throw new Error('Pilih setidaknya satu hari dalam rentang.')
    if (values.mode === 'timed' && !values.overnight && values.endTime <= values.startTime) throw new Error('Jam selesai harus setelah mulai. Untuk lintas tengah malam, centang selesai besok.')
    const time = values.mode === 'interval' ? { mode: 'timed_interval', timezone: zone, starts_at: values.intervalStart, ends_at: values.intervalEnd } : values.mode === 'timed' ? {
      mode: 'daily_pattern', timezone: zone, range_start: values.start, range_end: lastDate,
      weekdays, start_local_time: values.startTime, end_local_time: values.endTime,
      end_day_offset: values.overnight ? 1 : 0,
    } : { mode: values.mode, timezone: zone, range_start: values.start, range_end: lastDate, weekdays: range ? weekdays : null }
    const otherTags = initial?.tags.filter((tag) => tag.system_key !== 'important').map((tag) => tag.id) ?? []
    return api<Schedule>(initial ? `/schedules/${initial.id}` : '/schedules', { method: initial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token }, body: JSON.stringify({ title: values.title.trim(), category: values.category, status: values.status, time, tag_ids: [...otherTags, ...(importantTag && values.important ? [importantTag.id] : [])], reminder_offsets_minutes: values.reminders ? initial?.reminder_offsets_minutes.length ? initial.reminder_offsets_minutes : [1440, 60] : [], ...(initial ? { expected_version: initial.version } : {}) }) })
  }, onSuccess: async (row) => {
    // POST already returns the detail. Do not wait for unrelated network requests.
    queryClient.setQueryData(['schedule', row.id], row)
    await agendaChanged(queryClient)
    navigate(`/agenda/${row.id}`, { replace: true, state: { saved: true } })
  }, onSettled: () => { saving.current = false } })
  const weekdays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
  const back = initial ? `/agenda/${initial.id}` : '/agenda'
  return <div className="app-content-page app-agenda-composer"><PageHeading title={initial ? 'Edit agenda' : 'Agenda baru'} description={initial ? 'Perubahan berlaku untuk seluruh agenda, termasuk semua tanggal berulang.' : 'Judul, tanggal, waktu. Langsung simpan.'} back={back} />
    <form className="app-form app-agenda-form" onSubmit={handleSubmit((values) => { if (!saving.current) { saving.current = true; create.mutate(values) } })}>
      <fieldset className="app-form-body" disabled={create.isPending}>
      <label>Judul agenda<input autoFocus enterKeyHint="done" placeholder="Contoh: rapat tim" maxLength={200} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'agenda-title-error' : undefined} {...register('title', { validate: (value) => !!value.trim() || 'Judul harus diisi.' })} />{errors.title && <span id="agenda-title-error" className="app-field-error">{errors.title.message}</span>}</label>
      {mode !== 'interval' && <div className="app-date-row"><label>Tanggal mulai<input type="date" {...register('start', { required: true, onChange: (event) => { if (event.target.value > getValues('end')) setValue('end', event.target.value) } })} /></label><label className="app-checkbox"><input type="checkbox" {...register('repeat')} />Berulang</label></div>}
      {mode !== 'interval' && repeat && <div className="app-advanced"><label>Tanggal akhir<input type="date" min={start} {...register('end', { required: repeat })} /></label>{start !== end && <fieldset className="app-weekdays"><legend>Hari berulang</legend>{weekdays.map((label, index) => <label key={label}><input type="checkbox" checked={selectedDays.includes(index + 1)} onChange={() => setSelectedDays((current) => current.includes(index + 1) ? current.filter((day) => day !== index + 1) : [...current, index + 1].sort())} />{label}</label>)}</fieldset>}</div>}
      <fieldset className="app-choice" aria-label="Waktu"><label><input type="radio" value="timed" {...register('mode')} />Jam tertentu</label><label><input type="radio" value="date_only" {...register('mode')} />Tanpa jam</label><label><input type="radio" value="all_day" {...register('mode')} />Seharian</label>{initial?.time.mode === 'timed_interval' && <label><input type="radio" value="interval" {...register('mode')} />Interval asli</label>}</fieldset>
      {mode === 'interval' && <div className="app-advanced"><p>Interval tersimpan dipertahankan. Gunakan tanggal ISO dengan offset, misalnya 2026-11-16T09:00:00+07:00.</p><label>Mulai interval<input required {...register('intervalStart')} /></label><label>Selesai interval<input required {...register('intervalEnd')} /></label></div>}
      {mode === 'timed' && <div className="app-time-section"><div className="app-form-pair app-time-pair"><label>Mulai<input type="time" required {...register('startTime', { onChange: (event) => setDuration(minutes > 0 && minutes < 1440 ? minutes : 60, event.target.value) })} /></label><label>Selesai<input type="time" required {...register('endTime')} /></label></div><div className="app-duration-presets" role="group" aria-label="Durasi agenda">{[30, 60, 120].map((value) => <button type="button" key={value} aria-pressed={minutes === value} onClick={() => setDuration(value)}>{duration(value)}</button>)}<span>{zone}</span></div>{(overnight || endTime <= startTime) && <label className="app-checkbox"><input type="checkbox" {...register('overnight')} />Selesai besok</label>}</div>}
      <label className="app-checkbox"><input type="checkbox" {...register('important')} />Tandai Important</label>
      <button type="button" className="app-disclosure" aria-expanded={advanced} aria-controls="agenda-advanced" onClick={() => setAdvanced(!advanced)}>Kategori & opsi lainnya <ChevronRight className={advanced ? 'turned' : ''} size={18} aria-hidden /></button>
      <div id="agenda-advanced" hidden={!advanced}>{advanced && <div className="app-advanced"><div className="app-form-pair"><label>Kategori<select {...register('category')}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Status<select {...register('status')}><option value="Confirmed">Confirmed</option><option value="Tentative">Tentative</option></select></label></div><label className="app-checkbox"><input type="checkbox" {...register('reminders')} />Simpan pengingat untuk ekspor .ics</label><p>Ekspor .ics belum tersedia; pilihan ini belum membuat pengingat Google.</p>{mode === 'timed' && endTime > startTime && !overnight && <label className="app-checkbox"><input type="checkbox" {...register('overnight')} />Selesai besok</label>}</div>}</div>
      </fieldset>
      {create.error && <div role="alert" className="app-alert">{create.error.message}{create.error instanceof ApiError && create.error.code === 'VERSION_CONFLICT' && reload && <button type="button" onClick={() => void reload()}>Muat versi terbaru (mengganti isian)</button>}</div>}
      <div className="app-form-actions"><Link to={back} className="app-secondary">Batal</Link><button className="app-primary" type="submit" disabled={create.isPending}>{create.isPending ? 'Menyimpan…' : initial ? 'Simpan perubahan' : 'Simpan agenda'}</button></div>
    </form>
  </div>
}

function AgendaEditor({ me }: { me: Me }) {
  const { id } = useParams()
  const schedule = useQuery({ queryKey: ['schedule', id], queryFn: () => api<Schedule>(`/schedules/${id}`), enabled: !!id })
  const [draft, setDraft] = useState<Schedule | null>(null)
  useEffect(() => { if (!draft && schedule.data) setDraft(schedule.data) }, [draft, schedule.data])
  const reload = async () => {
    const result = await schedule.refetch()
    if (result.data && !result.isError) setDraft(result.data)
  }
  if (draft) return <AgendaForm key={`${draft.id}-${draft.version}`} me={me} initial={draft} reload={reload} />
  return <div className="app-content-page"><PageHeading title="Edit agenda" back={`/agenda/${id}`} />{schedule.isError ? <p role="alert" className="app-alert">Agenda belum dapat dimuat. <button onClick={() => void schedule.refetch()}>Coba lagi</button></p> : <p role="status">Memuat agenda…</p>}</div>
}

function DeleteAgendaDialog({ row, pending, error, cancel, confirm }: { row: Schedule; pending: boolean; error: Error | null; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="app-dialog" aria-labelledby="delete-agenda-title" aria-describedby="delete-agenda-description" onCancel={(event) => { if (pending) event.preventDefault(); else cancel() }}>
    <h2 id="delete-agenda-title">Hapus agenda?</h2><p id="delete-agenda-description">“{row.title}” akan dihapus dari daftar dan kapasitas jadwal. Semua tanggal berulangnya ikut dihapus. Tindakan ini tidak bisa dibatalkan dari aplikasi.</p>
    {error && <p role="alert" className="app-alert">{error.message}</p>}
    <div className="app-dialog-actions"><button autoFocus className="app-secondary" disabled={pending} onClick={cancel}>{error ? 'Tutup dan tinjau ulang' : 'Batal'}</button><button className="app-danger" disabled={pending || (error instanceof ApiError && error.code === 'VERSION_CONFLICT')} onClick={confirm}>{pending ? 'Menghapus…' : 'Ya, hapus agenda'}</button></div>
  </dialog>
}

function AgendaDetail({ me }: { me: Me }) {
  const { id } = useParams()
  const location = useLocation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null)
  const schedule = useQuery({ queryKey: ['schedule', id], queryFn: () => api<Schedule>(`/schedules/${id}`), enabled: !!id, staleTime: 30_000 })
  const row = schedule.data
  const remove = useMutation({
    mutationFn: (target: Schedule) => api<void>(`/schedules/${target.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token }, body: JSON.stringify({ expected_version: target.version }) }),
    onSuccess: async () => {
      await agendaChanged(client)
      client.removeQueries({ queryKey: ['schedule', id] })
      navigate('/agenda', { replace: true, state: { deleted: true } })
    },
  })
  return <div className="app-content-page"><PageHeading title={row?.title ?? 'Detail agenda'} back="/agenda" description={row ? `${categoryName(row.category)} · ${row.status}` : undefined} action={row && <div className="app-detail-actions"><Link className="app-secondary" to={`/agenda/${row.id}/edit`}><Pencil size={16} aria-hidden />Edit</Link><button className="app-danger-quiet" onClick={() => { remove.reset(); setDeleteTarget(row) }}><Trash2 size={16} aria-hidden />Hapus</button></div>} />
    {deleteTarget && <DeleteAgendaDialog row={deleteTarget} pending={remove.isPending} error={remove.error} confirm={() => { if (!remove.isPending) remove.mutate(deleteTarget) }} cancel={() => { setDeleteTarget(null); if (remove.error) void schedule.refetch(); remove.reset() }} />}
    {location.state?.saved && <p className="app-save-confirmation" role="status"><Check size={17} aria-hidden />Agenda tersimpan.<Link to={`/agenda/new?date=${row?.time.range_start ?? ''}`}>Tambah lagi <Plus size={15} aria-hidden /></Link></p>}
    {schedule.isPending && <p role="status">Memuat detail agenda…</p>}
    {schedule.isError && <p role="alert" className="app-alert">Agenda belum dapat dimuat. <button onClick={() => void schedule.refetch()}>Coba lagi</button></p>}
    {row && <div className="app-detail-card"><p>{row.tags.some((tag) => tag.system_key === 'important') && <span className="app-important"><Star size={15} fill="currentColor" aria-hidden />Important</span>}</p><dl><div><dt>Tanggal</dt><dd>{row.time.range_start ? `${formatDay(row.time.range_start, { dateStyle: 'medium' })}${row.time.range_end !== row.time.range_start ? ` – ${formatDay(row.time.range_end!, { dateStyle: 'medium' })}` : ''}` : row.time.starts_at ? formatDay(localIso(row.time.starts_at, row.time.timezone), { dateStyle: 'medium' }) : '—'}</dd></div><div><dt>Waktu</dt><dd>{row.time.mode === 'daily_pattern' ? `${row.time.start_local_time}–${row.time.end_local_time}${row.time.end_day_offset ? ' · selesai besok' : ''}` : row.time.mode === 'timed_interval' && row.time.starts_at && row.time.ends_at ? `${formatTime(row.time.starts_at, row.time.timezone)}–${formatTime(row.time.ends_at, row.time.timezone)}` : row.time.mode === 'all_day' ? 'Sepanjang hari' : 'Tanpa jam'}</dd></div><div><dt>Zona waktu</dt><dd>{row.time.timezone}</dd></div><div><dt>Pengingat .ics</dt><dd>{row.reminder_offsets_minutes.length ? row.reminder_offsets_minutes.map((minutes) => minutes === 1440 ? '1 hari sebelumnya' : minutes === 60 ? '1 jam sebelumnya' : `${minutes} menit sebelumnya`).join(', ') : 'Tidak disetel'}</dd></div></dl><p className="app-detail-note">Agenda ini tersimpan di aplikasi. Integrasi dan ekspor Google Calendar belum aktif pada build ini.</p></div>}
  </div>
}

export { Shell }
