import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { clearWeekCache } from './week-cache'
import { openStorageSettings, readStorageChoice, removeThemeCookie, saveStorageChoice, useStorageChoice } from './storage-consent'

export function CookieSettingsButton() {
  return <button type="button" className="privacy-link" onClick={event => openStorageSettings(event.currentTarget)}>Pengaturan cookie</button>
}

const storageError = 'Pilihan tidak dapat disimpan di browser ini. Penyimpanan opsional tetap tidak diaktifkan; kamu tetap dapat memakai aplikasi.'

// A non-modal bottom bar on the public gateway only. Reserve its measured height
// at the end of the page so the footer can scroll completely above it.
export function CookieNotice() {
  const choice = useStorageChoice()
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [height, setHeight] = useState(0)
  const notice = useRef<HTMLElement>(null)
  const visible = !choice && !dismissed
  useLayoutEffect(() => {
    const element = notice.current
    if (!visible || !element) return
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element, { box: 'border-box' })
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [visible])
  if (!visible) return null
  const save = (allow: boolean) => {
    if (!saveStorageChoice({ preferences: allow, agendaCache: allow })) setError(storageError)
  }
  return <div className="privacy-notice-reserve" style={{ height }}>
    <section ref={notice} className="privacy-notice" aria-labelledby="privacy-notice-title">
      <div className="privacy-notice-content">
        <div><h2 id="privacy-notice-title">Pilihan penyimpananmu</h2><p>Cookie wajib menjaga login. Tema dan agenda di perangkat hanya disimpan jika kamu mengizinkan. <a href="/cookies/">Kebijakan Cookie</a></p></div>
        <div className="privacy-actions"><button type="button" onClick={() => save(false)}>Hanya yang wajib</button><button type="button" onClick={() => save(true)}>Izinkan opsional</button><CookieSettingsButton /></div>
        {error && <p className="privacy-error" role="alert">{error}</p>}
      </div>
      <button type="button" className="privacy-notice-close" aria-label="Tutup pemberitahuan cookie" onClick={() => setDismissed(true)}><X size={20} aria-hidden /></button>
    </section>
  </div>
}

export function CookiePrivacy() {
  const choice = useStorageChoice()
  const [open, setOpen] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [agendaCache, setAgendaCache] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const show = (event: Event) => {
      trigger.current = (event as CustomEvent<HTMLButtonElement>).detail
      const current = readStorageChoice()
      setPreferences(current?.preferences ?? false)
      setAgendaCache(current?.agendaCache ?? false)
      setError('')
      setOpen(true)
    }
    window.addEventListener('myschedule:storage-settings', show)
    return () => window.removeEventListener('myschedule:storage-settings', show)
  }, [])
  useEffect(() => {
    if (!choice?.preferences) removeThemeCookie()
    if (!choice?.agendaCache) void clearWeekCache()
  }, [choice?.preferences, choice?.agendaCache])
  useEffect(() => {
    if (!open) return
    const element = dialog.current!
    element.showModal()
    return () => { element.close(); if (trigger.current?.isConnected) trigger.current.focus() }
  }, [open])
  const save = (allowPreferences: boolean, allowCache: boolean) => {
    if (!saveStorageChoice({ preferences: allowPreferences, agendaCache: allowCache })) {
      setError(storageError)
      return
    }
    setError('')
    setOpen(false)
  }
  return <>
    {error && !open && <p className="privacy-error" role="alert">{error}</p>}
    {open && <dialog ref={dialog} className="privacy-dialog" aria-labelledby="privacy-settings-title" onCancel={() => setOpen(false)}>
      <h2 id="privacy-settings-title">Pengaturan cookie</h2>
      <p>Pilih penyimpanan di browser ini. Pilihan berlaku untuk semua akun di browser ini, bukan perangkat lain. Tidak ada cookie iklan atau analytics yang diaktifkan oleh aplikasi.</p>
      <div className="privacy-option"><label><input type="checkbox" checked disabled />Cookie wajib <span>Selalu aktif</span></label><p>Untuk login, keamanan OAuth, dan mengingat pilihan penyimpanan selama 180 hari. Tidak digunakan untuk iklan.</p></div>
      <div className="privacy-option"><label><input type="checkbox" checked={preferences} onChange={event => setPreferences(event.target.checked)} />Ingat tema tampilan</label><p>Menyimpan pilihan terang/gelap selama 30 hari. Tanpa izin, perubahan tema hanya berlaku selama halaman terbuka.</p></div>
      <div className="privacy-option"><label><input type="checkbox" checked={agendaCache} onChange={event => setAgendaCache(event.target.checked)} />Simpan agenda di perangkat</label><p>Menyimpan cache mingguan, termasuk judul dan waktu agenda, di IndexedDB. Cache berusia lebih dari 30 hari tidak dipakai. Sebaiknya matikan pada perangkat bersama.</p></div>
      <p>Mematikan opsi menghapus cookie tema atau cache lokal aplikasi, bukan agenda dan catatan di server. Data sementara di memori tetap dipakai agar navigasi lancar.</p>
      <p className="privacy-policy-links"><a href="/cookies/">Kebijakan Cookie</a> dan <a href="/privacy/">Kebijakan Privasi</a>. Pilihan ini bukan persetujuan terhadap Ketentuan Layanan.</p>
      {error && <p className="privacy-error" role="alert">{error}</p>}
      <div className="privacy-actions"><button type="button" onClick={() => save(preferences, agendaCache)}>Simpan pilihan</button><button type="button" onClick={() => save(false, false)}>Hanya yang wajib</button><button type="button" onClick={() => setOpen(false)}>Batal</button></div>
    </dialog>}
  </>
}
