import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Circle, Eye, EyeOff } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, fetchMe, type Me, type PasswordContext, type PasswordSecurity, type ServerStatus } from './api/client'
import { CookieNotice, CookieSettingsButton } from './CookiePrivacy'
import { ThemeSwitch } from './theme'
import { passwordLink, passwordRules, validUsername, type AccountMode } from './account-access'
import { forgetCalendar } from './week-cache'
import './account-access.css'

type Props = {
  mode: AccountMode; me: Me | null | undefined; status?: ServerStatus;
  pending: boolean; sessionPending: boolean; error: Error | null; retry: () => void;
}
const copy = {
  login: { title: 'Masuk ke MySchedule', description: 'Lanjutkan ke agenda dan catatan pribadimu.', action: 'Masuk', unavailable: 'Login email belum tersedia. Untuk saat ini, gunakan Google.' },
  signup: { title: 'Buat akun baru', description: 'Satu tempat untuk agenda, kapasitas harian, dan catatanmu.', action: 'Buat akun', unavailable: 'Pendaftaran email belum dibuka. Kamu tetap bisa membuat akun dengan Google.' },
  forgot: { title: 'Lupa password?', description: 'Gunakan email akunmu untuk meminta tautan pengaturan password baru.', action: 'Kirim tautan reset', unavailable: 'Pemulihan password melalui email belum tersedia. Belum ada email yang dikirim dari formulir ini.' },
  activate: { title: 'Aktifkan password akun', description: 'Gunakan undangan yang dikirim ke emailmu untuk mengatur password.', action: 'Aktifkan password', unavailable: 'Aktivasi password melalui email belum tersedia. Formulir ini belum mengaktifkan akun atau memvalidasi undangan.' },
  reset: { title: 'Atur password baru', description: 'Gunakan tautan reset dari email untuk mengamankan kembali akunmu.', action: 'Simpan password baru', unavailable: 'Reset password melalui email belum tersedia. Formulir ini belum memvalidasi tautan atau mengubah password.' },
  change: { title: 'Ganti password', description: 'Gunakan password yang berbeda dari akun atau layanan lain.', action: 'Simpan password baru', unavailable: 'Perubahan password email belum tersedia. Formulir ini tidak mengubah password Google.' },
}

function PasswordField({ id, label, value, onChange, onBlur, autoComplete, help, invalid }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  onBlur: () => void; autoComplete: 'current-password' | 'new-password'; help?: string; invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // Password visibility never persists across a route change or leaving the tab.
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== 'visible') setVisible(false) }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  const Icon = visible ? EyeOff : Eye
  return <div className="access-field"><label htmlFor={id}>{label}</label>
    <div className="access-password">
      <input ref={input} id={id} name={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur} autoComplete={autoComplete} required maxLength={128} aria-invalid={invalid || undefined} aria-describedby={help} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="access-reveal" aria-label={`${visible ? 'Sembunyikan' : 'Lihat'} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={id} onClick={() => { setVisible(!visible); input.current?.focus() }}><Icon size={19} aria-hidden /></button>
    </div>
  </div>
}

export default function AccountAccess({ mode, me, status, pending, sessionPending, error, retry }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [values, setValues] = useState({ identifier: '', username: '', email: '', current: '', password: '', confirm: '' })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [attempted, setAttempted] = useState(false)
  const [token] = useState(() => ['activate', 'reset'].includes(mode) ? passwordLink(location.hash) : '')
  const [native, setNative] = useState<PasswordContext | null>(null)
  const [security, setSecurity] = useState<PasswordSecurity | null>(null)
  const [nativeLoading, setNativeLoading] = useState(true)
  const [nativeError, setNativeError] = useState(false)
  const [check, setCheck] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState('')
  const submitting = useRef(false)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (['activate', 'reset'].includes(mode) && window.location.hash) {
      // A fragment is never sent to the server. Remove it from the current
      // history entry after capture; keep the token in component memory only.
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
  }, [mode])
  useEffect(() => {
    const controller = new AbortController()
    setNativeLoading(true)
    setNativeError(false)
    void (async () => {
      try {
        const context = await api<PasswordContext>('/auth/password/context', { signal: controller.signal })
        if (controller.signal.aborted) return
        setNative(context)
        if (mode === 'change' && me) {
          const state = await api<PasswordSecurity>('/auth/password/security', { signal: controller.signal })
          if (!controller.signal.aborted && typeof state.password_active === 'boolean') setSecurity(state)
        }
      } catch {
        if (!controller.signal.aborted) { setNative(null); setNativeError(true) }
      } finally {
        if (!controller.signal.aborted) setNativeLoading(false)
      }
    })()
    return () => controller.abort()
  }, [mode, me?.user.id, check])
  useEffect(() => {
    const previous = document.title
    document.title = `${copy[mode].title} | MySchedule Manager`
    return () => { document.title = previous }
  }, [mode])
  useEffect(() => {
    title.current?.focus()
  }, [mode])
  const update = (key: keyof typeof values) => (value: string) => setValues(previous => ({ ...previous, [key]: value }))
  const blur = (key: keyof typeof values) => () => setTouched(previous => ({ ...previous, [key]: true }))
  const nativeReady = native?.enabled === true && typeof native.csrf_token === 'string' && !nativeLoading && !nativeError
  const requestInvitation = mode === 'activate' && nativeReady && !token
  const newPassword = ['signup', 'activate', 'reset', 'change'].includes(mode) && !requestInvitation
  const publicEntry = mode === 'login' || mode === 'signup'
  const rules = passwordRules(values.password)
  const invalidPassword = !!touched.password && newPassword && !rules.every(rule => rule.met)
  const mismatch = !!touched.confirm && values.confirm !== values.password
  const usernameError = !!touched.username && !validUsername(values.username)
  const googleReady = !!status?.google_login_configured && status.database === 'ready' && !pending && !error
  const googleFailed = !pending && (!!error || (!!status && !googleReady))
  const oauthError = new URLSearchParams(location.search).has('error')
  const available = nativeReady && mode !== 'signup' && !sessionPending
    && (mode !== 'reset' || !!token) && (mode !== 'change' || (!!me && security?.password_active === true))
  const availability = !nativeReady ? copy[mode].unavailable
    : mode === 'signup' ? 'Pendaftaran email belum dibuka. Aktivasi password masih melalui undangan untuk akun yang disetujui. Login Google tetap tersedia.'
      : mode === 'activate' ? (token ? 'Undangan berlaku 24 jam. Password hanya diaktifkan setelah kamu menyimpan formulir ini.' : 'Masukkan email akun yang disetujui untuk meminta undangan aktivasi.')
        : mode === 'reset' ? (token ? 'Tautan reset berlaku 30 menit dan hanya sekali pakai.' : 'Tautan reset tidak ditemukan. Minta tautan baru melalui Lupa password.')
          : mode === 'change' ? 'Mengubah password akan mengakhiri semua sesi aplikasi, termasuk browser ini. Kamu perlu masuk kembali.'
            : mode === 'forgot' ? 'Tautan reset hanya dikirim untuk akun dengan password dan email terverifikasi.'
              : 'Gunakan username atau email akun yang passwordnya sudah diaktifkan.'
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    setAttempted(true)
    setFailure('')
    setMessage('')
    if (!available) return
    if (newPassword && (!rules.every(rule => rule.met) || values.password !== values.confirm)) {
      setTouched(previous => ({ ...previous, password: true, confirm: true }))
      setFailure('Periksa persyaratan dan konfirmasi password.')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      const path = requestInvitation ? 'invitation' : mode
      const body = mode === 'login' ? { identifier: values.identifier, password: values.current }
        : mode === 'forgot' || requestInvitation ? { email: values.email }
          : mode === 'change' ? { current_password: values.current, password: values.password, confirmation: values.confirm }
            : { token, password: values.password, confirmation: values.confirm }
      // Direct request, never a mutation-cache payload or an automatically retried write.
      const result = await api<{ message: string } | undefined>(`/auth/password/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': mode === 'change' ? me!.csrf_token : native!.csrf_token! },
        body: JSON.stringify(body),
      })
      if (mode === 'login') {
        const verified = await fetchMe()
        if (!verified) throw new ApiError(401, 'SESSION_UNVERIFIED', 'Sesi belum dapat diverifikasi.')
        queryClient.setQueryData(['me'], verified)
        navigate('/', { replace: true })
      } else if (mode === 'forgot' || requestInvitation) {
        if (typeof result?.message !== 'string') throw new Error('Invalid mail response')
        setMessage(result.message)
      } else {
        setValues({ identifier: '', username: '', email: '', current: '', password: '', confirm: '' })
        await forgetCalendar(queryClient, true)
        await queryClient.cancelQueries({ queryKey: ['me'] })
        navigate('/login', { replace: true, state: { passwordUpdated: true } })
        queryClient.setQueryData(['me'], null)
      }
    } catch (cause) {
      const messages: Record<string, string> = {
        PASSWORD_LOGIN_FAILED: 'Username/email atau password tidak cocok. Untuk ganti password, periksa password saat ini.',
        PASSWORD_POLICY: 'Gunakan 8-128 karakter, minimal satu kapital dan satu angka.',
        PASSWORD_TOO_COMMON: 'Pilih password yang tidak umum dan bukan turunan username atau email.',
        PASSWORD_REUSED: 'Pilih password baru yang berbeda.',
        PASSWORD_LINK_INVALID: 'Tautan tidak valid atau kedaluwarsa. Minta tautan baru.',
        PASSWORD_RATE_LIMIT: 'Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.',
        CSRF_FAILED: 'Sesi formulir berakhir. Muat ulang halaman sebelum mencoba lagi.',
        SESSION_UNVERIFIED: 'Sesi belum dapat diverifikasi. Muat ulang halaman untuk memeriksa akun.',
        NETWORK_UNAVAILABLE: 'Server belum dapat dijangkau. Periksa koneksi.',
      }
      setFailure(cause instanceof ApiError ? messages[cause.code] ?? 'Permintaan belum berhasil. Coba lagi sebentar.' : 'Permintaan belum berhasil. Coba lagi sebentar.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const renderPassword = () => <>
    <PasswordField id="password" label={mode === 'signup' ? 'Password' : 'Password baru'} value={values.password} onChange={update('password')} onBlur={blur('password')} autoComplete="new-password" help="access-password-rules access-password-limit" invalid={invalidPassword} />
    <ul id="access-password-rules" className="access-rules" aria-label="Persyaratan password">{rules.map(rule => <li key={rule.key} data-met={rule.met}>{rule.met ? <Check size={14} aria-hidden /> : <Circle size={12} aria-hidden />}<span>{rule.label}<span className="sr-only">: {rule.met ? 'terpenuhi' : 'belum terpenuhi'}</span></span></li>)}</ul>
    <p id="access-password-limit" className="access-hint">Maksimal 128 karakter. Simbol boleh digunakan.</p>
    <PasswordField id="confirm-password" label="Konfirmasi password" value={values.confirm} onChange={update('confirm')} onBlur={blur('confirm')} autoComplete="new-password" help={mismatch ? 'access-confirm-error' : undefined} invalid={mismatch} />
    {mismatch && <p id="access-confirm-error" className="access-field-error" role="alert">Konfirmasi password belum sama.</p>}
  </>
  const content = (body: ReactNode) => <><div className="access-page">
    <header className="access-header"><Link to="/" className="access-brand" aria-label="MySchedule Manager, halaman utama"><img src="/icons/brand-80.png?v=my-paper-1" width={40} height={40} alt="" /><span>MySchedule Manager</span></Link><ThemeSwitch compact /></header>
    <main className="access-main">{body}</main>
    <footer className="access-footer"><nav aria-label="Kebijakan layanan"><a href="/privacy/">Kebijakan Privasi</a><a href="/terms/">Ketentuan Layanan</a><CookieSettingsButton /></nav></footer>
  </div><CookieNotice /></>
  if (publicEntry && me) return content(<section className="access-card"><h1 ref={title} tabIndex={-1}>Kamu sudah masuk</h1><p>Agenda dan catatanmu siap dibuka.</p><Link className="access-primary" to="/">Buka MySchedule</Link></section>)
  if (mode === 'change' && !me) return content(<section className="access-card"><h1 ref={title} tabIndex={-1}>{sessionPending ? 'Memeriksa sesi' : 'Masuk terlebih dahulu'}</h1><p role={sessionPending ? 'status' : undefined}>{sessionPending ? 'Memastikan akunmu sebelum membuka pengaturan password.' : 'Pengaturan password hanya tersedia setelah sesi akun terverifikasi.'}</p>{!sessionPending && <Link className="access-primary" to="/login">Ke halaman masuk</Link>}</section>)
  if (mode === 'change' && nativeReady && security && !security.password_active) return content(<section className="access-card"><h1 ref={title} tabIndex={-1}>Ganti password</h1><p>{security.enabled ? 'Password akun ini belum diaktifkan. Minta undangan untuk menetapkannya melalui email.' : 'Akses password belum tersedia untuk akun ini. Kamu tetap bisa memakai login Google.'}</p>{security.enabled && <Link className="access-back" to="/activate-password">Minta undangan aktivasi</Link>}<Link className="access-back" to="/settings">Kembali ke pengaturan</Link></section>)
  return content(<section className="access-card" aria-labelledby="access-title">
    {publicEntry && <nav className="access-tabs" aria-label="Akses akun"><NavLink to="/login">Masuk</NavLink><NavLink to="/signup">Buat akun</NavLink></nav>}
    <h1 id="access-title" ref={title} tabIndex={-1}>{copy[mode].title}</h1>
    <p className="access-description">{copy[mode].description}</p>
    {mode === 'login' && location.state?.passwordUpdated === true && <p className="access-availability" role="status">Password berhasil disimpan. Semua sesi aplikasi sebelumnya diakhiri. Silakan masuk kembali.</p>}
    {publicEntry && <>
      {googleReady ? <a className="welcome-google access-google" href="/api/v1/auth/google/start?return_to=/"><img src="/icons/google-g.png" alt="" width={20} height={20} />{mode === 'signup' ? 'Daftar dengan Google' : 'Masuk dengan Google'}</a>
        : <button className="welcome-google access-google" disabled aria-describedby="access-google-state"><img src="/icons/google-g.png" alt="" width={20} height={20} />{pending ? 'Memeriksa akses…' : 'Google belum tersedia'}</button>}
      {pending && <p id="access-google-state" className="access-hint" role="status">Memeriksa layanan masuk Google.</p>}
      {googleFailed && <div id="access-google-state" className="access-service-error" role="alert"><p>{error ? 'Koneksi belum berhasil. Coba lagi untuk masuk dengan Google.' : 'Login Google belum tersedia. Coba lagi sebentar.'}</p><button className="text-button" onClick={retry}>Coba lagi</button></div>}
      {oauthError && <p className="access-field-error" role="alert">Proses masuk Google belum selesai. Silakan mulai kembali.</p>}
      <p className="access-divider">atau dengan email</p>
    </>}
    <form className="access-form" method="post" onSubmit={submit} aria-describedby="access-availability">
      <p id="access-availability" className="access-availability" role="status">{availability}</p>
      {nativeError && <div className="access-service-error"><p>Akses password belum dapat diperiksa.</p><button type="button" className="text-button" onClick={() => setCheck(value => value + 1)}>Periksa akses password</button></div>}
      {mode === 'login' && <>
        <div className="access-field"><label htmlFor="identifier">Username atau email</label><input id="identifier" name="username" value={values.identifier} onChange={event => update('identifier')(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} /></div>
        <PasswordField id="current-password" label="Password" value={values.current} onChange={update('current')} onBlur={blur('current')} autoComplete="current-password" />
        <Link className="access-forgot" to="/forgot-password">Lupa password?</Link>
      </>}
      {mode === 'signup' && <div className="access-field"><label htmlFor="username">Username</label><input id="username" name="username" value={values.username} onChange={event => update('username')(event.target.value)} onBlur={blur('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" aria-invalid={usernameError || undefined} aria-describedby="access-username-help" /><p id="access-username-help" className={usernameError ? 'access-field-error' : 'access-hint'}>3-30 karakter: huruf, angka, titik, atau garis bawah. Kapital tidak membedakan akun.</p></div>}
      {(mode === 'signup' || mode === 'forgot' || requestInvitation) && <div className="access-field"><label htmlFor="email">Email{mode === 'signup' ? ' untuk verifikasi' : ''}</label><input id="email" name="email" type="email" value={values.email} onChange={event => update('email')(event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} aria-describedby={mode === 'signup' ? 'access-email-help' : undefined} />{mode === 'signup' && <p id="access-email-help" className="access-hint">Gunakan email aktif yang bisa kamu buka.</p>}</div>}
      {mode === 'change' && <PasswordField id="current-password" label="Password saat ini" value={values.current} onChange={update('current')} onBlur={blur('current')} autoComplete="current-password" />}
      {newPassword && renderPassword()}
      <button type="submit" className="access-primary" disabled={!available || busy} aria-describedby="access-availability">{busy ? 'Memproses…' : requestInvitation ? 'Kirim undangan' : copy[mode].action}</button>
      {attempted && !available && !busy && <p className="access-field-error" role="alert">{availability}</p>}
      {failure && <p className="access-field-error" role="alert">{failure}</p>}
      {message && <p className="access-availability" role="status">{message}</p>}
    </form>
    {mode === 'signup' && <p className="access-legal">Dengan membuat akun, kamu menyetujui <a href="/terms/">Ketentuan Layanan</a>. Baca <a href="/privacy/">Kebijakan Privasi</a> sebelum melanjutkan.</p>}
    {mode === 'login' && nativeReady && <Link className="access-back" to="/activate-password">Punya undangan aktivasi?</Link>}
    {mode === 'reset' && nativeReady && <Link className="access-back" to="/forgot-password">Minta tautan reset baru</Link>}
    {!publicEntry && <Link className="access-back" to={mode === 'change' ? '/settings' : '/login'}>{mode === 'change' ? 'Kembali ke pengaturan' : 'Kembali ke halaman masuk'}</Link>}
  </section>)
}
