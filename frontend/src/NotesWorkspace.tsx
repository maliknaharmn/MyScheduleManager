import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, ChevronRight, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useFieldArray, useForm } from 'react-hook-form'
import { api, ApiError, type Me } from './api/client'
import type { ListResult, Note, NoteDetail } from './api/resources'
import { PageHeading } from './components/PageHeading'
import { noteDate, noteStatus, noteTimestamp, noteToday } from './note-model'
import { notesChanged } from './week-cache'

const filters = [['open', 'Belum selesai'], ['overdue', 'Lewat target'], ['completed', 'Selesai'], ['all', 'Semua']] as const
function noteQuery(id: string | undefined) {
  return { queryKey: ['note', id], enabled: !!id, staleTime: 30_000, queryFn: ({ signal }: { signal: AbortSignal }) => api<NoteDetail>(`/notes/${id}`, { signal }) }
}
function missing(error: Error | null) { return error instanceof ApiError && error.status === 404 }

export function NotesList({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const filter = filters.some(([value]) => value === params.get('filter')) ? params.get('filter')! : 'open'
  const completion = filter === 'overdue' ? 'open' : filter
  const search = params.get('q') ?? ''
  const today = noteToday(me.profile.timezone)
  const notes = useQuery({ queryKey: ['notes', completion], queryFn: ({ signal }) => api<ListResult<Note>>(`/notes?completion=${completion}&limit=100`, { signal }) })
  const rows = (notes.data?.items ?? []).filter((row) => (filter !== 'overdue' || row.target_end < today) && `${row.title} ${row.body ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  return <div className="notes-page">
    <PageHeading title="Catatan" description="Rincian, target, dan langkah persiapanmu." action={<Link className="app-primary" to="/notes/new" state={{ notesSearch: location.search }}><Plus size={18} aria-hidden />Catatan</Link>} />
    {location.state?.deleted && <p className="notes-feedback" role="status">Catatan dihapus.</p>}
    <div className="app-tab-row" role="group" aria-label="Status catatan">{filters.map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => update('filter', value)}>{label}</button>)}</div>
    <div className="app-filter-bar"><label><Search size={18} aria-hidden /><span className="sr-only">Cari catatan</span><input value={search} onChange={(event) => update('q', event.target.value)} placeholder="Cari judul atau isi catatan" /></label></div>
    {notes.isError && <p className="app-alert" role="alert">Catatan belum dapat diperbarui. <button onClick={() => void notes.refetch()}>Coba lagi</button></p>}
    {notes.data && <p className="notes-list-count">{rows.length} catatan ditampilkan{notes.data.has_more ? ' dari halaman yang dimuat' : ''}</p>}
    <div className="app-list-panel">{notes.isPending ? <p role="status">Memuat catatan…</p> : notes.isError && !notes.data ? null : rows.length ? rows.map((row) => <Link className="app-list-item notes-list-item" key={row.id} to={`/notes/${row.id}`} state={{ notesSearch: location.search }}>
      <div><strong>{row.is_important && <Star size={14} fill="currentColor" aria-label="Important" />} {row.title}</strong><span>{noteStatus(row, today)} · {noteDate(row.target_start)}{row.target_end !== row.target_start ? ` - ${noteDate(row.target_end)}` : ''}</span>{row.body && <p>{row.body}</p>}<span>{row.total_items ? `${row.completed_items} dari ${row.total_items} langkah dicentang` : 'Tanpa checklist'}</span></div><ChevronRight size={18} aria-hidden />
    </Link>) : <div className="app-empty"><h2>{search ? 'Tidak ada hasil' : filter === 'completed' ? 'Belum ada yang selesai' : filter === 'overdue' ? 'Tidak ada yang lewat target' : 'Belum ada catatan'}</h2><p>{search ? 'Coba kata kunci lain pada catatan yang dimuat.' : filter === 'open' ? 'Mulai dengan satu target dan langkah persiapannya.' : 'Ubah filter untuk melihat catatan lainnya.'}</p>{filter === 'open' && !search && <Link to="/notes/new">Tambah catatan</Link>}</div>}</div>
    {notes.data?.has_more && <p className="app-limited">Pencarian dan filter hanya mencakup hingga 100 catatan yang dimuat, bukan seluruh akun.</p>}
  </div>
}

type NoteFields = { title: string; body: string; start: string; end: string; important: boolean; checklist: { item_id?: string; title: string; completed_at?: string | null }[] }

export function NoteForm({ me, initial, reload }: { me: Me; initial?: NoteDetail; reload?: () => Promise<void> }) {
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()
  const saving = useRef(false)
  const today = noteToday(me.profile.timezone)
  const back = initial ? `/notes/${initial.id}` : `/notes${location.state?.notesSearch ?? ''}`
  const form = useForm<NoteFields>({ defaultValues: {
    title: initial?.title ?? '', body: initial?.body ?? '', start: initial?.target_start ?? today, end: initial?.target_end ?? today, important: initial?.is_important ?? false,
    checklist: initial?.checklist.map((item) => ({ item_id: item.id, title: item.title, completed_at: item.completed_at })) ?? [],
  } })
  const { register, watch, getValues, setValue, handleSubmit, control, formState: { errors, isDirty } } = form
  const { fields, append, remove, move } = useFieldArray({ control, name: 'checklist' })
  const items = watch('checklist')
  const removed = initial?.checklist.filter((item) => !items.some((value) => value.item_id === item.id)).length ?? 0
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])
  useEffect(() => { if (location.hash === '#checklist') document.getElementById('note-checklist')?.scrollIntoView({ block: 'start' }) }, [location.hash])
  const save = useMutation({ retry: false,
    mutationFn: (values: NoteFields) => api<NoteDetail>(initial ? `/notes/${initial.id}` : '/notes', {
      method: initial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token },
      body: JSON.stringify({ title: values.title.trim(), body: values.body.trim() || null, target_start: values.start, target_end: values.end, is_important: values.important,
        checklist: values.checklist.map((item) => ({ title: item.title.trim(), ...(initial && item.item_id ? { id: item.item_id } : {}) })),
        ...(initial ? { expected_version: initial.version } : { reminder: { enabled: false }, prerequisite_note_ids: [] }),
      }),
    }),
    onSuccess: async (row) => { await notesChanged(client, row, row.id); navigate(`/notes/${row.id}`, { replace: true, state: { saved: true, notesSearch: location.state?.notesSearch } }) },
    onSettled: () => { saving.current = false },
  })
  return <div className="notes-page notes-editor"><PageHeading title={initial ? 'Edit catatan' : 'Catatan baru'} description="Target catatan tidak menambah jam kapasitas agenda." back={back} />
    <form className="app-form notes-form" onSubmit={handleSubmit((values) => { if (!saving.current) { saving.current = true; save.mutate(values) } })}>
      <fieldset className="notes-form-body" disabled={save.isPending}>
        <label>Judul catatan<input autoFocus maxLength={200} placeholder="Contoh: siapkan berkas" aria-invalid={!!errors.title} {...register('title', { validate: (value) => !!value.trim() || 'Judul harus diisi.' })} />{errors.title && <span className="app-field-error">{errors.title.message}</span>}</label>
        <label>Isi catatan<textarea rows={4} placeholder="Rincian, bahan, atau hal yang perlu diingat" {...register('body')} /></label>
        <div className="app-form-pair"><label>Target mulai<input type="date" required {...register('start', { required: true, onChange: (event) => { if (event.target.value > getValues('end')) setValue('end', event.target.value, { shouldDirty: true }) } })} /></label><label>Target akhir<input type="date" required min={watch('start')} {...register('end', { required: true, validate: (value) => value >= getValues('start') || 'Target akhir tidak boleh sebelum target mulai.' })} />{errors.end && <span className="app-field-error">{errors.end.message}</span>}</label></div>
        <label className="app-checkbox"><input type="checkbox" {...register('important')} />Tandai Important</label>
        <section id="note-checklist" className="notes-checklist-editor" aria-labelledby="note-checklist-heading">
          <h2 id="note-checklist-heading">Langkah persiapan</h2><p>Tambah, ubah, hapus, atau urutkan langkah. Centang yang sudah tersimpan tetap dipertahankan.</p>
          {fields.length === 0 && <p>Belum ada checklist. Catatan tetap dapat disimpan tanpa langkah.</p>}
          <ol>{fields.map((field, index) => <li key={field.id}>
            <label>Langkah {index + 1}<input maxLength={200} placeholder="Apa yang perlu dilakukan?" {...register(`checklist.${index}.title`, { validate: (value) => !!value.trim() || 'Isi langkah atau hapus baris kosong ini.' })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (event.currentTarget.value.trim() && fields.length < 100) append({ title: '' }) } }} />{errors.checklist?.[index]?.title && <span className="app-field-error">{errors.checklist[index]?.title?.message}</span>}{items[index]?.completed_at && <span className="notes-item-state"><Check size={13} aria-hidden />Sudah dicentang</span>}</label>
            <div className="notes-item-actions"><button type="button" className="app-secondary" aria-label={`Naikkan langkah ${index + 1}`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={16} aria-hidden /></button><button type="button" className="app-secondary" aria-label={`Turunkan langkah ${index + 1}`} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}><ArrowDown size={16} aria-hidden /></button><button type="button" className="app-danger-quiet" aria-label={`Hapus langkah ${index + 1}`} onClick={() => remove(index)}><Trash2 size={16} aria-hidden /></button></div>
          </li>)}</ol>
          <button type="button" className="app-secondary" disabled={fields.length >= 100} onClick={() => append({ title: '' })}><Plus size={16} aria-hidden />Tambah langkah</button>
          {fields.length >= 100 && <p>Maksimal 100 langkah per catatan.</p>}
          {removed > 0 && <p className="notes-removal-warning">{removed} langkah lama akan dihapus setelah perubahan disimpan.</p>}
        </section>
        <p className="notes-hint">Perubahan di form ini baru tersimpan setelah menekan Simpan. Pengingat Google dan pengelolaan prasyarat belum tersedia.</p>
      </fieldset>
      {save.error && <div className="app-alert" role="alert">{save.error.message}{save.error instanceof ApiError && save.error.code === 'VERSION_CONFLICT' && reload && <button type="button" onClick={() => void reload()}>Muat versi terbaru (mengganti isian)</button>}</div>}
      <div className="app-form-actions notes-form-actions"><Link className="app-secondary" to={back} state={{ notesSearch: location.state?.notesSearch }}>Batal</Link><button type="submit" className="app-primary" disabled={save.isPending}>{save.isPending ? 'Menyimpan…' : initial ? 'Simpan perubahan' : 'Simpan catatan'}</button></div>
    </form>
  </div>
}

export function NoteEditor({ me }: { me: Me }) {
  const { id } = useParams()
  const source = useQuery(noteQuery(id))
  const [draft, setDraft] = useState<NoteDetail | null>(null)
  useEffect(() => { if (source.data && (!draft || draft.id !== id)) setDraft(source.data) }, [source.data, draft, id])
  const reload = async () => { const result = await source.refetch(); if (result.data && !result.isError) setDraft(result.data) }
  if (missing(source.error)) return <NoteUnavailable />
  if (draft && draft.id === id) {
    if (draft.completed_at || draft.has_calendar_mapping) return <div className="notes-page"><PageHeading title="Edit catatan" back={`/notes/${id}`} /><p className="app-alert">{draft.completed_at ? 'Catatan sudah selesai. Buka kembali dari detail sebelum mengedit.' : 'Pengingat terkelola perlu ditinjau sebelum catatan dapat diedit.'}</p></div>
    return <NoteForm key={`${draft.id}-${draft.version}`} me={me} initial={draft} reload={reload} />
  }
  return <div className="notes-page"><PageHeading title="Edit catatan" back={`/notes/${id}`} />{source.isError ? <p className="app-alert" role="alert">Catatan belum dapat dimuat. <button onClick={() => void source.refetch()}>Coba lagi</button></p> : <p role="status">Memuat catatan…</p>}</div>
}

function NoteUnavailable() {
  return <div className="notes-page"><PageHeading title="Catatan tidak tersedia" back="/notes" /><p role="alert">Catatan sudah dihapus atau tidak dapat diakses oleh akun ini.</p></div>
}

function NoteDialog({ title, children, confirmLabel, pending, error, danger, cancel, confirm }: { title: string; children: ReactNode; confirmLabel: string; pending: boolean; error: Error | null; danger: boolean; cancel: () => void; confirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="app-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { if (pending) event.preventDefault(); else cancel() }}>
    <h2 id={titleId}>{title}</h2><div id={descriptionId} className="notes-dialog-copy">{children}</div>
    {error && <p role="alert" className="app-alert">{error.message}</p>}
    <div className="app-dialog-actions"><button autoFocus className="app-secondary" disabled={pending} onClick={cancel}>{error ? 'Tutup dan tinjau ulang' : 'Batal'}</button><button className={danger ? 'app-danger' : 'app-primary'} disabled={pending || (error instanceof ApiError && error.code === 'VERSION_CONFLICT')} onClick={confirm}>{pending ? 'Menyimpan…' : confirmLabel}</button></div>
  </dialog>
}

type NoteAction = { kind: 'toggle' | 'complete' | 'reopen' | 'delete'; target: NoteDetail; itemId?: string; completed?: boolean; allowIncomplete?: boolean }

export function NoteDetailScreen({ me }: { me: Me }) {
  const { id } = useParams()
  const source = useQuery(noteQuery(id))
  const client = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const inFlight = useRef(false)
  const [dialog, setDialog] = useState<{ kind: 'delete' | 'complete'; target: NoteDetail } | null>(null)
  const [notice, setNotice] = useState('')
  const mutation = useMutation({ retry: false,
    mutationFn: (action: NoteAction): Promise<NoteDetail | void> => {
      const path = `/notes/${action.target.id}`
      const init = { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token } }
      if (action.kind === 'delete') return api<void>(path, { ...init, method: 'DELETE', body: JSON.stringify({ expected_version: action.target.version }) })
      if (action.kind === 'toggle') return api<NoteDetail>(`${path}/checklist-items/${action.itemId}`, { ...init, method: 'PATCH', body: JSON.stringify({ expected_version: action.target.version, completed: action.completed }) })
      return api<NoteDetail>(`${path}/${action.kind}`, { ...init, method: 'POST', body: JSON.stringify({ expected_version: action.target.version, ...(action.kind === 'complete' ? { allow_incomplete_checklist: !!action.allowIncomplete } : {}) }) })
    },
    onSuccess: async (value, action) => {
      await notesChanged(client, value ?? null, action.target.id)
      setDialog(null)
      if (action.kind === 'delete') navigate(`/notes${location.state?.notesSearch ?? ''}`, { replace: true, state: { deleted: true } })
      else setNotice(action.kind === 'toggle' ? 'Checklist tersimpan.' : action.kind === 'reopen' ? 'Catatan dibuka kembali. Centang checklist tetap dipertahankan.' : 'Catatan ditandai selesai. Centang checklist tidak diubah.')
    },
    onSettled: () => { inFlight.current = false },
  })
  const run = (action: NoteAction) => { if (!inFlight.current) { inFlight.current = true; mutation.mutate(action) } }
  const row = source.data
  if (missing(source.error)) return <NoteUnavailable />
  if (!row) return <div className="notes-page"><PageHeading title="Detail catatan" back="/notes" />{source.isError ? <p className="app-alert" role="alert">Catatan belum dapat dimuat. <button onClick={() => void source.refetch()}>Coba lagi</button></p> : <p role="status">Memuat detail catatan…</p>}</div>
  const pending = mutation.isPending
  const linked = row.prerequisite_count > 0 || row.dependent_count > 0
  const remaining = row.total_items - row.completed_items
  const editState = { notesSearch: location.state?.notesSearch }
  const cancelDialog = () => { setDialog(null); if (mutation.error) void source.refetch(); mutation.reset() }
  return <div className="notes-page">
    <PageHeading title={row.title} back={`/notes${location.state?.notesSearch ?? ''}`} action={<div className="app-detail-actions">
      {!row.completed_at && !row.has_calendar_mapping && <Link className="app-secondary" to={`/notes/${row.id}/edit`} state={editState} aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault() }}><Pencil size={16} aria-hidden />Edit catatan</Link>}
      <button className="app-danger-quiet" disabled={pending || row.has_calendar_mapping || linked} onClick={() => { mutation.reset(); setDialog({ kind: 'delete', target: row }) }}><Trash2 size={16} aria-hidden />Hapus</button>
    </div>} />
    {(notice || location.state?.saved) && <p className="notes-feedback" role="status">{notice || 'Catatan tersimpan.'}</p>}
    {source.isError && <p className="app-alert" role="alert">Pembaruan detail belum berhasil. Data terakhir tetap ditampilkan. <button onClick={() => void source.refetch()}>Coba lagi</button></p>}
    <article className="app-detail-card notes-card">
      <dl className="notes-summary"><div><dt>Status catatan</dt><dd>{noteStatus(row, noteToday(me.profile.timezone))}</dd></div><div><dt>Target</dt><dd>{noteDate(row.target_start)}{row.target_end !== row.target_start ? ` - ${noteDate(row.target_end)}` : ''}</dd></div></dl>
      {row.is_important && <p className="notes-priority"><Star size={15} fill="currentColor" aria-hidden />Important</p>}
      <section className="notes-section"><h2>Rincian catatan</h2><p className="notes-body">{row.body || 'Belum ada rincian tambahan.'}</p></section>
      <section className="notes-section"><div className="notes-section-heading"><h2>Checklist</h2>{!row.completed_at && !row.has_calendar_mapping && <Link to={`/notes/${row.id}/edit#checklist`} state={editState} aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault() }}>Kelola checklist <Pencil size={14} aria-hidden /></Link>}</div>
        <p>{row.total_items ? `${row.completed_items} dari ${row.total_items} langkah dicentang` : 'Belum ada checklist. Tidak dianggap 100% selesai.'}</p>
        {row.total_items > 0 && <div className="app-progress" role="progressbar" aria-label="Progres checklist" aria-valuemin={0} aria-valuemax={row.total_items} aria-valuenow={row.completed_items}><span style={{ width: `${row.completed_items / row.total_items * 100}%` }} /></div>}
        <ul className="app-checklist notes-checklist">{row.checklist.map((item) => <li key={item.id}><label><input type="checkbox" checked={!!item.completed_at} disabled={pending || !!row.completed_at} onChange={() => run({ kind: 'toggle', target: row, itemId: item.id, completed: !item.completed_at })} /><span className={item.completed_at ? 'notes-checked' : ''}>{item.title}</span></label></li>)}</ul>
        <p className="notes-hint">{row.completed_at ? 'Buka kembali catatan untuk mengubah isian atau checklist.' : 'Centang tersimpan otomatis. Status catatan tetap ditentukan secara terpisah.'}</p>
      </section>
      <section className="notes-section notes-lifecycle"><h2>{row.completed_at ? 'Catatan selesai' : 'Penyelesaian catatan'}</h2><p>{row.completed_at ? `Diselesaikan ${noteTimestamp(row.completed_at, me.profile.timezone)}.` : remaining > 0 ? `${remaining} langkah belum dicentang. Menyelesaikan catatan tidak mencentangnya otomatis.` : row.total_items ? 'Semua langkah sudah dicentang. Tandai catatan selesai jika targetnya benar-benar tercapai.' : 'Tandai selesai ketika target catatan sudah tercapai.'}</p>
        <button className="app-primary" disabled={pending || row.has_calendar_mapping || (row.completed_at ? linked : row.prerequisite_count > 0)} onClick={() => { mutation.reset(); if (row.completed_at) run({ kind: 'reopen', target: row }); else if (remaining > 0) setDialog({ kind: 'complete', target: row }); else run({ kind: 'complete', target: row }) }}>{pending ? 'Menyimpan…' : row.completed_at ? 'Buka kembali' : 'Tandai catatan selesai'}</button>
      </section>
      <details className="notes-system-details"><summary>Pengingat & informasi catatan</summary><p>{row.has_calendar_mapping ? 'Pengingat terkelola terdeteksi. Edit, hapus, dan perubahan status ditahan sampai sinkronisasi Calendar tersedia.' : row.reminder_enabled ? 'Preferensi pengingat tersimpan, tetapi pengiriman pengingat Google Calendar belum tersedia.' : 'Pengingat tidak disetel. Integrasi pengingat Google belum tersedia.'}</p><p>Target catatan tidak memesan jam di agenda.</p><dl className="notes-audit"><div><dt>Dibuat</dt><dd>{noteTimestamp(row.created_at, me.profile.timezone)}</dd></div><div><dt>Diperbarui</dt><dd>{noteTimestamp(row.updated_at, me.profile.timezone)}</dd></div></dl></details>
      {(row.has_calendar_mapping || linked) && <p className="app-alert">{row.has_calendar_mapping ? 'Ada pengingat terkelola; beberapa tindakan ditahan agar tidak meninggalkan pengingat di Google.' : `Catatan ini memiliki ${row.prerequisite_count} prasyarat dan dipakai oleh ${row.dependent_count} catatan. Hapus dan pembukaan kembali ditahan; pengelolaan hubungan belum tersedia.${row.prerequisite_count > 0 ? ' Penyelesaian juga menunggu peninjauan prasyarat.' : ''}`}</p>}
      {mutation.error && !dialog && <div className="app-alert" role="alert">{mutation.error.message}<button onClick={() => { mutation.reset(); void source.refetch() }}>Muat versi terbaru</button></div>}
    </article>
    {dialog && <NoteDialog title={dialog.kind === 'delete' ? 'Hapus catatan?' : 'Selesaikan catatan?'} confirmLabel={dialog.kind === 'delete' ? 'Ya, hapus catatan' : 'Tetap selesaikan'} danger={dialog.kind === 'delete'} pending={pending} error={mutation.error} cancel={cancelDialog} confirm={() => run({ kind: dialog.kind, target: dialog.target, allowIncomplete: dialog.kind === 'complete' })}>
      <p>{dialog.kind === 'delete' ? `“${dialog.target.title}” beserta checklist akan dihapus dari daftar dan Home. Tindakan ini tidak bisa dibatalkan dari aplikasi.` : `Masih ada ${dialog.target.total_items - dialog.target.completed_items} langkah yang belum dicentang pada “${dialog.target.title}”. Checklist tidak akan dicentang otomatis. Anda dapat membuka kembali catatan nanti.`}</p>
    </NoteDialog>}
  </div>
}
