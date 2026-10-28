# Backend — FastAPI

Fondasi lokal: 14 model SQLAlchemy + migrasi PostgreSQL/RLS, domain kapasitas, Google OIDC/sesi/CSRF, profil, health/config status, dan adapter Calendar untuk risk spike. Agenda dan catatan mendukung create/read/update/soft-delete berversi; catatan juga mendukung pengelolaan checklist, penyelesaian eksplisit dan buka kembali. **Belum worker reminder produksi atau pengelolaan prasyarat.**

## FastAPI Cloud

- Atur **Application Directory** ke `backend` pada app yang sudah terhubung ke GitHub.
- Dependency `fastapi[standard]` menyediakan CLI yang dipakai proses startup Cloud; memasang `fastapi` saja tidak cukup.
- `pyproject.toml` menetapkan entrypoint `myschedule.main:app`; Python dipin ke seri 3.13, sama dengan CI.
- Setelah dependency berubah, gunakan **build baru dari commit terbaru**. Redeploy image lama tetap membawa dependency lama dan dapat mengulang error yang sama.
- Uji `/health/live` untuk startup proses. `/health/ready` baru 200 setelah koneksi, role database dan migrasi siap; booting sukses tidak membuktikan login Google/database sudah berfungsi.
- Tes deployment lokal/CI menjalankan **`python -m fastapi run`** sungguhan, bukan hanya mengimpor app melalui test client.

Root `/` belum menyajikan bundle React dalam backend ini; deployment backend bukan deployment full-stack otomatis. Sesi OAuth masih single-process seperti batas yang dijelaskan di bawah.

## Instalasi

Gunakan Python 3.13; jalankan dari `backend/`:

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e .
```

Untuk membuat konfigurasi baru pada PostgreSQL **lokal yang sudah berjalan**, dengan OS role yang boleh membuat database/role:

```sh
python3.13 scripts/provision_local.py
.venv/bin/alembic upgrade head
```

Script membuat database `myschedule_dev`/`myschedule_test` dan role khusus, tanpa memodifikasi cluster/database lain. Ia menolak resource atau `.env` yang sudah ada, bukan menimpa password/data. Tidak memulai service sistem. Di mesin development sesi ini, provisioning dan migrasi telah dilakukan; **jangan jalankan provisioning ulang**. Untuk konfigurasi manual gunakan `.env.example`, role non-superuser, dan grant sesuai migrasi.

`DATABASE_URL` untuk role request, `AUTH_DATABASE_URL` untuk lookup/bootstrap sesi yang terbatas, `MIGRATION_DATABASE_URL` hanya owner untuk migrasi. Jangan memasukkan URL owner sebagai koneksi API. Tes hanya memakai tiga `TEST_*DATABASE_URL` pada database bersufiks `_test` dan tidak fallback ke development.

## Jalankan

```sh
.venv/bin/python -m uvicorn myschedule.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
```

Frontend Vite memproxy `/api` dan `/health` ke backend, sehingga cookie dan CSRF memakai satu origin `http://localhost:5173`. Access log dimatikan supaya query callback OAuth tidak masuk log. Jangan menaruh token/credentials di command line, log atau browser storage.

## Endpoint yang benar-benar diimplementasikan

- `GET /health/live`, `GET /health/ready`.
- `GET /api/v1/status`: readiness tanpa secret; menandai capability MVP yang belum aktif secara jujur.
- `GET /api/v1/auth/google/start`, `GET /api/v1/auth/google/callback`.
- `GET /api/v1/me`, `PATCH /api/v1/me/profile`, `POST /api/v1/auth/logout`.
- `GET /api/v1/tags`; `GET/POST /api/v1/schedules`; `GET /api/v1/schedules/{id}`.
- `PATCH/DELETE /api/v1/schedules/{id}`: owner + CSRF + `expected_version`; konflik 409, resource terhapus/akun lain 404. PATCH memakai seluruh field input agenda beserta versi; DELETE menerima JSON versi. Berlaku untuk seluruh seri berulang.
- `GET /api/v1/overview/week?week_start=YYYY-MM-DD` untuk Senin–Minggu berdasarkan zona profil dan mesin kapasitas.
- Parameter `weeks=1..5` pada overview memuat sampai 35 hari dalam satu rentang query untuk prefetch bulanan; default tetap 1 minggu. Tidak ada cache privat di cookie atau respons HTTP publik.
- `GET/POST /api/v1/notes`; `GET /api/v1/notes/{id}`; `PATCH /api/v1/notes/{id}/checklist-items/{item_id}`; `POST /api/v1/notes/{id}/complete`.
- `PATCH/DELETE /api/v1/notes/{id}`; `POST /api/v1/notes/{id}/reopen`: owner + CSRF + `expected_version`. PATCH menerima seluruh field editable (judul, isi, target, Important, checklist). Checklist dengan `id` mempertahankan centang/timestamp; tanpa `id` membuat langkah baru; ID lama yang dihilangkan menghapus langkah. ID berulang/asing ditolak; urutan array menentukan posisi.
- Catatan selesai harus dibuka kembali sebelum edit/toggle. Complete dengan checklist tersisa ditolak `409 CHECKLIST_INCOMPLETE` kecuali konfirmasi `allow_incomplete_checklist: true`. Complete/reopen tidak mengubah centang. Detail/mutasi menyertakan timestamp dan metadata jumlah relasi/mapping; daftar tetap 2 query data.
- Delete memakai soft delete dan versi, menghilangkan catatan dari seluruh daftar/detail. Calendar mapping lama menahan edit/delete/complete/reopen; tautan prasyarat menahan delete/reopen dan catatan yang memiliki prasyarat menahan complete sampai pengelolaan relasi tersedia.
- `/docs` dan `/openapi.json` tersedia hanya non-production.

Login Google hanya aktif setelah OAuth/allowlist/secret/database dikonfigurasi. Tidak ada endpoint dev-login, fake user, atau bypass auth. Callback flow dites menggunakan provider mock; Google nyata belum diuji. Handshake state/nonce/PKCE saat ini tersimpan sekali pakai di memori proses dengan TTL dan browser binding: restart gagal tertutup. **Jalankan satu API worker saja untuk fase ini; multi-worker/replica memerlukan shared handshake storage terlebih dahulu.**

Alur baru memakai sesi pemilik akun, CSRF untuk mutasi, dan aturan kapasitas domain (durasi bertumpuk dihitung sekali; agenda tanpa durasi membuat hasil parsial). Pengingat yang disimpan belum membuat notifikasi. Penyelesaian catatan dengan prasyarat atau Calendar mapping lama ditahan sampai lifecycle pengingat selesai dibangun.

Daftar agenda memuat tag/pengingat secara batch (3 query data untuk sampai 100 agenda), dan daftar catatan memuat checklist secara batch (2 query data). Jumlah ini tidak termasuk lookup sesi dan `set_config` RLS. Tes regresi di `tests/test_resources.py` memeriksa jumlah query, asosiasi relasi, urutan, dan batas daftar pada PostgreSQL test; aturan owner/CSRF tetap berlaku.

## Tes dan kontrak

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/python -m pytest -q
.venv/bin/alembic check
.venv/bin/python scripts/export_openapi.py
```

`pytest -m 'not database'` menjalankan tes tanpa PostgreSQL. Jika konfigurasi test DB tidak ada, tes DB di-skip secara eksplisit, bukan dianggap passed. Database tests membuat data sintetis ber-ID acak dan membersihkan baris fixture mereka sendiri, tidak TRUNCATE development.

`openapi.json` hanya berisi endpoint publik yang sudah ada, bukan seluruh kontrak MVP di `docs/`. Frontend menghasilkan tipe TypeScript dari schema ini. Setelah dependency berubah, regenerasi lock dengan `piptools compile` seperti header lockfile; jangan memakai `pip freeze` dari lingkungan global.

Lock Python mem-pin versi (tanpa hash artefak). Ekspansi hash semua distribusi sempat terhambat timeout PyPI; jangan menambahkan `--require-hashes` pada file yang belum memuat hash. Ini tidak mengubah tes atau memperbolehkan dependency konflik.

## Google OAuth development

Buat OAuth client **Web application** di Google Cloud, dengan origin `http://localhost:5173` dan redirect URI persis `http://localhost:5173/api/v1/auth/google/callback`. Jika consent masih mode Testing, tambahkan akun uji pada Google Auth Platform → Audience → Test users.

Isi `backend/.env` secara lokal (placeholder berikut bukan kredensial valid):

```dotenv
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_WEB_CLIENT_SECRET
ALLOWED_GOOGLE_EMAILS=["your-account@example.invalid"]
APP_ORIGIN=http://localhost:5173
GOOGLE_REDIRECT_URI=http://localhost:5173/api/v1/auth/google/callback
```

Allowlist wajib array JSON dengan tanda kutip ganda. Pertahankan session secret dan koneksi database yang dibuat saat setup; jangan menggantinya dengan placeholder. Restart backend setelah mengubah `.env`. Login hanya meminta identitas Google; Calendar perlu consent terpisah dan flow produksinya belum diaktifkan.

Tidak ada kredensial Google yang dibutuhkan GitHub Actions: tes callback memakai provider mock, tes Calendar memakai transport simulasi, dan PostgreSQL CI terpisah dengan password ephemeral khusus CI. **Jangan upload `.env` lokal sebagai artefak CI atau menambahkan Google secret ke frontend.**

Dokumentasi perencanaan pribadi tetap lokal di `docs/` dan sengaja tidak tersedia setelah clone repository public. Panduan ini dan `.env.example` cukup untuk menjalankan fondasi tanpa mempublikasikan catatan pribadi.
