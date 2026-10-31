import { useSearchParams } from 'react-router-dom'
import type { ServerStatus } from './api/client'
import { ThemeSwitch, useTheme } from './theme'
import { CookieNotice, CookieSettingsButton } from './CookiePrivacy'

function Brand() {
  return <div className="brand"><span className="brand-mark"><img src="/icons/brand-80.png?v=my-paper-1" width={40} height={40} alt="" /></span><span>MySchedule<span className="brand-suffix"> Manager</span></span></div>
}

export function SessionLoading() {
  return <div className="welcome-session" role="status"><img src="/icons/brand-80.png?v=my-paper-1" width={40} height={40} alt="" /><p>Memeriksa sesi pribadi…</p><span className="welcome-loading-track" aria-hidden /></div>
}

export function Welcome({ status, error, pending, retry, staticPage = false }: { status?: ServerStatus; error: Error | null; pending: boolean; retry: () => void; staticPage?: boolean }) {
  const [params] = useSearchParams()
  const { theme } = useTheme()
  const available = status?.google_login_configured && status.database === 'ready'
  const canLogin = available && !error && !pending
  const unavailable = !pending && !!status && !available
  const loginError = params.has('error')
  return <><div className="welcome-public">
    <header className="welcome-public-header"><Brand />{!staticPage && <ThemeSwitch compact />}</header>
    <main>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-hero-copy">
          <h1 id="welcome-title">MySchedule<br /> Manager</h1>
          <p>Aplikasi agenda dan catatan pribadi untuk mengatur jadwal, melihat kapasitas harian, dan menuntaskan persiapan dengan checklist.</p>
          <div className="welcome-sign-in">
            {canLogin ? <a className="welcome-google" href="/api/v1/auth/google/start?return_to=/" aria-describedby="welcome-access-note"><img src="/icons/google-g.png" alt="" width={20} height={20} />Masuk dengan Google</a>
              : <button className="welcome-google" disabled aria-describedby={staticPage ? undefined : 'welcome-login-state'}><img src="/icons/google-g.png" alt="" width={20} height={20} />{staticPage ? 'Masuk dengan Google' : pending ? 'Memeriksa akses…' : 'Masuk belum tersedia'}</button>}
            {staticPage && <noscript><p className="welcome-service-message">Aktifkan JavaScript untuk masuk dan mengelola agenda. Informasi aplikasi dan kebijakan tetap dapat dibaca tanpa JavaScript.</p></noscript>}
            {!staticPage && pending && <span id="welcome-login-state" className="sr-only" role="status">Memeriksa layanan masuk.</span>}
            {!pending && (error || unavailable) && <div id="welcome-login-state" className="welcome-service-message" role="alert"><p>{error ? 'Koneksi belum berhasil. Periksa internet, lalu coba lagi.' : 'Layanan masuk sedang tidak tersedia. Silakan coba lagi sebentar.'}</p><button className="text-button" onClick={retry}>Coba lagi</button></div>}
            {!error && !unavailable && loginError && <p className="welcome-service-message" role="alert">Proses masuk belum selesai. Silakan coba kembali dengan akun Google-mu.</p>}
            <p className="welcome-legal-note">Dengan menggunakan layanan, kamu menyetujui <a href="/terms/">Ketentuan Layanan</a>. Baca cara data ditangani dalam <a href="/privacy/">Kebijakan Privasi</a>.</p>
          </div>
        </div>
        <figure className="welcome-preview"><picture><source type="image/avif" srcSet={`/previews/home-${theme}-720.avif 720w, /previews/home-${theme}-1200.avif 1200w`} sizes="(max-width: 760px) calc(100vw - 40px), (max-width: 1060px) calc(100vw - 64px), 636px" /><img src={`/previews/home-${theme}.png`} width={1200} height={820} alt="Contoh MySchedule Manager: kapasitas harian, catatan penting, dan agenda satu minggu." fetchPriority="high" /></picture><figcaption>Contoh tampilan dengan data ilustrasi.</figcaption></figure>
      </section>
      <section className="welcome-product-details" aria-label="Tentang MySchedule Manager">
        <div><h2>Kenali kapasitas harimu</h2><p>Lihat waktu yang sudah terisi sebelum menerima komitmen baru. Agenda yang bertumpuk dihitung sekali.</p></div>
        <div><h2>Persiapan sampai tuntas</h2><p>Simpan target dan rincian dalam catatan. Kelola checklist, selesaikan, atau buka kembali saat perlu.</p></div>
      </section>
      <section className="welcome-data-use" aria-labelledby="welcome-data-title">
        <h2 id="welcome-data-title">Google hanya untuk masuk</h2>
        <div><p>MySchedule Manager memakai pengenal akun Google, email terverifikasi, dan nama profil jika tersedia untuk membuat akun, memverifikasi login, dan menghubungkan agenda serta catatan dengan pemiliknya.</p><p>Aplikasi hanya meminta izin identitas: openid, email dan profile. Tidak meminta akses Gmail, Drive, kontak, atau Google Calendar. Baca rinciannya di <a href="/privacy/">Kebijakan Privasi</a>.</p></div>
      </section>
      <section className="welcome-questions" aria-labelledby="welcome-access-title">
        <h2 id="welcome-access-title">Sebelum mulai</h2>
        <div>
          <details open><summary>Siapa yang bisa masuk?</summary><p id="welcome-access-note">Siapa pun bisa masuk dengan akun Google. Agenda dan catatan tetap pribadi untuk setiap akun, bukan data bersama atau contoh tampilan di halaman ini.</p></details>
          <details><summary>Bagaimana kapasitas dihitung?</summary><p>Free: 0 jam. Light: lebih dari 0 dan kurang dari 6 jam. Medium: 6-10 jam. Busy: lebih dari 10 jam. Agenda tanpa durasi ditandai agar perkiraan kapasitas tidak menyesatkan.</p></details>
          <details><summary>Apakah terhubung ke Google Calendar?</summary><p>Google digunakan untuk masuk. Pengingat Google Calendar dan ekspor .ics belum tersedia. Agenda yang kamu buat tetap tersimpan di MySchedule.</p></details>
        </div>
      </section>
    </main>
    <footer className="welcome-public-footer"><div className="welcome-operator"><span>Pengelola: MySchedule Manager</span><a href="mailto:maliknahar.mn@gmail.com">maliknahar.mn@gmail.com</a></div><nav className="legal-links" aria-label="Kebijakan layanan"><a href="/privacy/">Kebijakan Privasi</a><a href="/terms/">Ketentuan Layanan</a><a href="/cookies/">Kebijakan Cookie</a><span id="cookie-settings">{staticPage ? <a href="/cookies/#pilihan">Pengaturan cookie</a> : <CookieSettingsButton />}</span></nav></footer>
  </div>{!staticPage && <CookieNotice />}</>
}
