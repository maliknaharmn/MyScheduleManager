import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, Check, ChevronRight, CircleAlert, Clock3,
  RefreshCw, ShieldCheck,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { api, ApiError, fetchMe, type Me, type ServerStatus } from './api/client'
import { Button } from './components/ui/button'
import { Shell } from './ScheduleWorkspace'
import { ThemeProvider } from './theme'
import { forgetCalendar } from './week-cache'

function Brand() {
  return <div className="brand"><span className="brand-mark"><img src="/icons/icon-192.png" alt="" /></span>
    <span>MySchedule<span className="brand-suffix"> Manager</span></span></div>
}

function StatusLine({ ready, label, detail }: { ready: boolean; label: string; detail: string }) {
  return <div className="status-line">
    <span className={ready ? 'status-check ready' : 'status-check waiting'}>
      {ready ? <Check size={16} aria-hidden /> : <Clock3 size={16} aria-hidden />}
    </span>
    <div><strong>{label}</strong><p>{detail}</p></div>
  </div>
}

function ConfigurationHelp() {
  return <div className="configuration-help" id="configuration-help">
    <strong>Konfigurasi disimpan di backend/.env</strong>
    <p>Isi Google Client ID, Client Secret, dan email akun yang diizinkan secara lokal.
      Jangan kirim secret ke chat atau simpan di Git.</p>
    <p>Callback Google untuk development:</p>
    <code>http://localhost:5173/api/v1/auth/google/callback</code>
    <p>Restart backend setelah mengubah konfigurasi. Login dan pengingat Google nyata
      masih memerlukan pengujian; belum ada koneksi Google yang diklaim aktif.</p>
  </div>
}

function Welcome({ status, error, retry }: {
  status?: ServerStatus; error: Error | null; retry: () => void
}) {
  const [help, setHelp] = useState(false)
  const [params] = useSearchParams()
  const loginReady = status?.google_login_configured && status.database === 'ready'
  return <div className="welcome-page">
    <header className="welcome-header"><Brand /><span className="build-badge">Build 02 · Ruang pribadi</span></header>
    <main className="welcome-layout">
      <section className="intro" aria-labelledby="welcome-title">
        <span className="eyebrow"><span className="eyebrow-dot" /> Ruang pribadi untuk komitmenmu</span>
        <h1 id="welcome-title">Jadwal jelas.<br /><span>Yang penting</span><br />tetap terjaga.</h1>
        <p className="intro-copy">Lihat kapasitas sebelum menerima komitmen baru.
          Catat agenda, pantau persiapan, dan selesaikan satu per satu.</p>
        <div className="principle-list">
          <div><Clock3 aria-hidden size={18} /><span>Kapasitas dihitung dari jam, bukan tebakan.</span></div>
          <div><ShieldCheck aria-hidden size={18} /><span>Data pribadi. Satu akun di iPhone dan Mac.</span></div>
        </div>
        <div className="capacity-legend" aria-label="Aturan kapasitas yang disepakati">
          <span className="capacity free">Free <small>0 jam</small></span>
          <span className="capacity light">Light <small>&lt;6 jam</small></span>
          <span className="capacity medium">Medium <small>6–10 jam</small></span>
          <span className="capacity busy">Busy <small>&gt;10 jam</small></span>
        </div>
        <p className="legend-note">Light dimulai setelah 0 jam. Durasi yang belum diketahui akan ditandai.</p>
      </section>
      <section className="setup-card" aria-labelledby="setup-title">
        <span className="card-icon"><ShieldCheck size={24} aria-hidden /></span>
        <h2 id="setup-title">Mulai dari ruangmu sendiri</h2>
        <p>Login Google untuk mengakses data pribadi. Izin Calendar diminta terpisah dari login.</p>
        {params.get('error') && <p className="notice warning" role="alert">Login belum selesai. Silakan coba kembali.</p>}
        {error && <p className="notice warning" role="alert">{error.message} <button className="text-button" onClick={retry}>Coba lagi</button></p>}
        {loginReady
          ? <a className="button button-primary google-login" href="/api/v1/auth/google/start?return_to=/">
              <GoogleMark /> Lanjutkan dengan Google <ArrowRight size={18} aria-hidden />
            </a>
          : <Button className="google-login" disabled><GoogleMark />
              {status ? 'Login menunggu konfigurasi' : 'Memeriksa server…'}
            </Button>}
        <div className="divider" />
        <div className="setup-heading"><h3>Kesiapan lokal</h3><span>Bukan status produksi</span></div>
        <StatusLine ready={!!status} label="API FastAPI" detail={status ? 'Server merespons.' : 'Memeriksa koneksi backend.'} />
        <StatusLine ready={status?.database === 'ready'} label="Database PostgreSQL"
          detail={status?.database === 'ready' ? 'Migrasi terpasang, role API terbatas.' : 'Menunggu koneksi dan migrasi database.'} />
        <StatusLine ready={!!status?.google_login_configured} label="Google login"
          detail={status?.google_login_configured ? 'Konfigurasi tersedia; login nyata perlu diuji.' : 'OAuth dan akun yang diizinkan belum dikonfigurasi.'} />
        <div className="foundation-note"><CircleAlert size={17} aria-hidden />
          <p>Agenda, kapasitas mingguan, catatan, dan checklist sudah tersedia setelah login.
            Pengingat Google Calendar dan ekspor .ics belum aktif. Tidak ada data contoh yang disimpan sebagai jadwalmu.</p></div>
        <button className="text-button setup-toggle" onClick={() => setHelp(!help)} aria-expanded={help} aria-controls="configuration-help">
          {help ? 'Tutup panduan konfigurasi' : 'Lihat panduan konfigurasi'} <ChevronRight size={16} aria-hidden />
        </button>
        {help && <ConfigurationHelp />}
      </section>
    </main>
    <footer className="welcome-footer">MySchedule Manager · Private by intention · Tanpa input bahasa alami pada MVP</footer>
  </div>
}

function GoogleMark() {
  return <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.35ZM12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H3.07v2.59A10 10 0 0 0 12 22ZM6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59ZM12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.71 9.4 5.96 12 5.96Z" /></svg>
}

function Preferences({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [editingVersion, setEditingVersion] = useState(me.profile.version)
  const { register, handleSubmit, reset, formState: { isDirty } } = useForm({ defaultValues: {
    timezone: me.profile.timezone, daily_reminder_time: me.profile.daily_reminder_time,
  } })
  useEffect(() => {
    if (!isDirty && me.profile.version !== editingVersion) {
      reset({ timezone: me.profile.timezone, daily_reminder_time: me.profile.daily_reminder_time })
      setEditingVersion(me.profile.version)
    }
  }, [isDirty, me.profile, editingVersion, reset])
  const mutation = useMutation({
    mutationFn: (values: { timezone: string; daily_reminder_time: string }) => api<Me['profile']>('/me/profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token },
      body: JSON.stringify({ ...values, expected_version: editingVersion }),
    }),
    onSuccess: (profile) => {
      reset({ timezone: profile.timezone, daily_reminder_time: profile.daily_reminder_time })
      setEditingVersion(profile.version)
      queryClient.setQueryData<Me>(['me'], (previous) => previous ? { ...previous, profile } : previous)
    },
  })
  return <div className="workspace-card">
    <h2>Preferensi baru</h2><p>Perubahan default tidak menggeser resource yang sudah tersimpan.</p>
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="preferences-form">
      {isDirty && me.profile.version !== editingVersion && <p role="alert" className="notice warning">
        Profil sudah berubah di perangkat lain. Isianmu tidak ditimpa; simpan akan meminta peninjauan ulang.
      </p>}
      <label>Zona waktu IANA<input {...register('timezone', { required: true })} required /></label>
      <label>Jam default pengingat catatan<input type="time" {...register('daily_reminder_time')} required /></label>
      <Button type="submit" disabled={!isDirty || mutation.isPending}>{mutation.isPending ? 'Menyimpan…' : 'Simpan preferensi'}</Button>
      {mutation.isSuccess && <p role="status">Preferensi tersimpan.</p>}
      {mutation.error && <p role="alert" className="notice warning">{mutation.error.message}
        {mutation.error instanceof ApiError && mutation.error.code === 'VERSION_CONFLICT'
          ? ' Isianmu tetap ada; muat ulang dan tinjau perubahan perangkat lain.' : ''}</p>}
    </form>
    <div className="divider" /><h3>Google Calendar</h3>
    <p>Integrasi pengingat belum diaktifkan pada build ini. Tidak ada reminder yang diklaim aktif.</p>
  </div>
}

function Workspace({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [logoutError, setLogoutError] = useState('')
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': me.csrf_token } }),
    onSuccess: async () => {
      await forgetCalendar(queryClient, true)
      await queryClient.cancelQueries()
      // Publish the signed-out state to the active observer, not just remove its cache.
      queryClient.setQueryData<Me | null>(['me'], null)
      navigate('/', { replace: true })
    },
    onError: (error) => setLogoutError(error.message),
  })
  return <Shell me={me} settings={<Preferences me={me} />}
    logout={() => logout.mutate()} logoutPending={logout.isPending} logoutError={logoutError} />
}

export function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>
}

function AppContent() {
  const queryClient = useQueryClient()
  // Revalidate identity on focus; only resource data gets a short freshness window.
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 })
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<ServerStatus>('/status'), enabled: !me.isPending && !me.data, staleTime: 30_000, refetchInterval: 30_000 })
  useEffect(() => {
    if (me.isSuccess && !me.data) void forgetCalendar(queryClient)
  }, [me.isSuccess, me.data, queryClient])
  if (me.isPending) return <div className="loading-page" role="status"><RefreshCw size={24} className="spin" aria-hidden />Memeriksa sesi pribadi…</div>
  if (me.data) return <Workspace me={me.data} />
  return <Welcome status={status.data} error={me.error ?? status.error} retry={() => { void me.refetch(); void status.refetch() }} />
}
