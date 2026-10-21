# Backend — FastAPI

Fondasi lokal pertama: 14 model SQLAlchemy + migrasi PostgreSQL/RLS, domain kapasitas, Google OIDC/sesi/CSRF, profil, health/config status, dan adapter Calendar untuk risk spike. **Belum CRUD agenda/catatan atau worker reminder produksi.**

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
- `/docs` dan `/openapi.json` tersedia hanya non-production.

Login Google hanya aktif setelah OAuth/allowlist/secret/database dikonfigurasi. Tidak ada endpoint dev-login, fake user, atau bypass auth. Callback flow dites menggunakan provider mock; Google nyata belum diuji. Handshake state/nonce/PKCE saat ini tersimpan sekali pakai di memori proses dengan TTL dan browser binding: restart gagal tertutup. **Jalankan satu API worker saja untuk fase ini; multi-worker/replica memerlukan shared handshake storage terlebih dahulu.**

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
