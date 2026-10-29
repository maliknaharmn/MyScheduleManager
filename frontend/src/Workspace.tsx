import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { api, ApiError, type Me } from './api/client'
import { Button } from './components/ui/button'
import { Shell } from './ScheduleWorkspace'
import { forgetCalendar } from './week-cache'
import { CookieSettingsButton } from './CookiePrivacy'

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
    <h2>Preferensi</h2><p>Zona waktu digunakan untuk tanggal hari ini dan agenda baru. Agenda yang sudah disimpan tidak berubah.</p>
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="preferences-form">
      {isDirty && me.profile.version !== editingVersion && <p role="alert" className="notice warning">
        Profil sudah berubah di perangkat lain. Isianmu tidak ditimpa; simpan akan meminta peninjauan ulang.
      </p>}
      <label>Zona waktu IANA<input {...register('timezone', { required: true })} required /></label>
      <label>Jam default pengingat catatan<input type="time" aria-describedby="reminder-preference-help" {...register('daily_reminder_time')} required /></label>
      <p id="reminder-preference-help">Waktu ini disimpan sebagai preferensi. Pengiriman pengingat belum tersedia.</p>
      <Button type="submit" disabled={!isDirty || mutation.isPending}>{mutation.isPending ? 'Menyimpan…' : 'Simpan preferensi'}</Button>
      {mutation.isSuccess && <p role="status">Preferensi tersimpan.</p>}
      {mutation.error && <p role="alert" className="notice warning">{mutation.error.message}
        {mutation.error instanceof ApiError && mutation.error.code === 'VERSION_CONFLICT'
          ? ' Isianmu tetap ada; muat ulang dan tinjau perubahan perangkat lain.' : ''}</p>}
    </form>
    <div className="divider" /><h3>Google Calendar</h3>
    <p>Pengingat Google Calendar belum tersedia. Agenda dan catatan tetap tersimpan di MySchedule.</p>
    <div className="divider" /><h3>Privasi di perangkat</h3><p>Kelola cookie tema dan penyimpanan agenda di browser. Pilihan ini tidak menghapus data akun.</p><CookieSettingsButton />
    <nav className="legal-links settings-legal-links" aria-label="Kebijakan layanan"><a href="/privacy/">Kebijakan Privasi</a><a href="/terms/">Ketentuan Layanan</a><a href="/cookies/">Kebijakan Cookie</a></nav>
  </div>
}

export default function Workspace({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [logoutError, setLogoutError] = useState('')
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': me.csrf_token } }),
    onSuccess: async () => {
      await forgetCalendar(queryClient, true)
      await queryClient.cancelQueries()
      queryClient.setQueryData<Me | null>(['me'], null)
      navigate('/', { replace: true })
    },
    onError: (error) => setLogoutError(error.message),
  })
  return <Shell me={me} settings={<Preferences me={me} />}
    logout={() => logout.mutate()} logoutPending={logout.isPending} logoutError={logoutError} />
}
