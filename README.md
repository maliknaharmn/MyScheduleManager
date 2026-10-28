# MySchedule Manager

**Status:** React/FastAPI/PostgreSQL berjalan dan dites lokal; agenda serta catatan mendukung tambah/detail/edit/hapus. Catatan memiliki checklist yang dapat dikelola, penyelesaian eksplisit dan buka kembali; tema light/dark serta cache mingguan/bulanan tersedia. **Belum MVP lengkap**—pengingat Google dan pengelolaan prasyarat terhubung belum aktif.

Repository ini public. Secret, `.env`, data lokal, dan direktori perencanaan pribadi `docs/` tidak diikutkan dalam Git. Panduan yang tersedia setelah clone ada di [backend README](backend/README.md) dan [frontend README](frontend/README.md).

MySchedule Manager membantu satu pengguna melihat kapasitas jadwal pribadi, mencatat komitmen cepat, serta memantau catatan bertarget dengan checklist dan prasyarat terhubung. Produk ini adalah **personal schedule overview dan decision-support tool**, bukan pengganti seluruh Google Calendar. Keputusan menerima tawaran tetap dibuat pengguna di luar aplikasi.

Target MVP adalah web app responsif/PWA untuk iPhone Home Screen dan browser Mac, **Google login saja**, dengan data yang tersinkron otomatis. Kapasitas berdasarkan jam: Free 0, Light >0–<6, Medium 6–10, Busy >10; Tentative ikut dihitung. Pengingat catatan harian direncanakan memakai integrasi Google Calendar terbatas dan berhenti otomatis saat selesai; ekspor agenda `.ics` satu arah menyusul. Input bahasa alami ditunda. Nama folder kerja `MyCalender Manager` dipertahankan; nama produk **MySchedule Manager**.

Pipeline kini: **fondasi lokal + risk spike → implementasi → QA/pilot**. Baseline produk/desain diterima; catatan persetujuan tetap lokal di `docs/product/APPROVAL.md`. Provider hosting, credentials, biaya dan deployment belum ditetapkan oleh persetujuan desain.

## Mulai dari sini

Untuk instalasi baru, ikuti [backend README](backend/README.md) terlebih dahulu untuk virtualenv, PostgreSQL dan migrasi, lalu jalankan `npm ci` dari `frontend/`. Setelah itu buka dua terminal:

**Terminal di `backend/`:**

```sh
.venv/bin/python -m uvicorn myschedule.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
```

**Terminal di `frontend/`:**

```sh
npm run dev
```

Buka **http://localhost:5173**. Isi konfigurasi Google di `backend/.env` secara lokal; lihat bagian Google OAuth pada [backend README](backend/README.md). Jangan commit secret atau menaruhnya di frontend.

Jika port 8000 dipakai aplikasi lain, gunakan port 8002 untuk perintah backend dan jalankan frontend dengan `API_PROXY_TARGET=http://127.0.0.1:8002 npm run dev`. Origin browser/callback Google tetap `http://localhost:5173`.

## Dokumentasi perencanaan lokal

Daftar berikut hanya tersedia pada workspace perencanaan; direktori `docs/` sengaja tidak dipublikasikan. Path ditampilkan sebagai referensi lokal, bukan tautan yang tersedia setelah clone.

| Dokumen                                            | Isi                                                          |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `docs/product/DISCOVERY.md` | Dasar jawaban pengguna dan riwayat keputusan |
| `docs/product/PRD.md` | Masalah, ruang lingkup MVP, kebutuhan dan acceptance |
| `docs/design/UX_FLOW.md` | Navigasi dan alur pengguna |
| `docs/design/DESIGN_SYSTEM.md` | Komponen, visual dan aksesibilitas |
| `docs/technical/TECHNICAL_PLAN.md` | Arsitektur dan urutan implementasi |
| `docs/technical/ERD.md` | Tabel, relasi dan constraint |
| `docs/technical/API_CONTRACT.md` | Kontrak API MVP |
| `docs/design/WIREFRAMES.md` | Layar, form dan state |
| `docs/technical/BUILD_HANDOFF.md` | Keputusan dan gate implementasi |
| `docs/technical/IMPLEMENTATION_BACKLOG.md` | Dependency dan acceptance per tiket |
| `docs/technical/QA_PLAN.md` | Rencana tes dan traceability |
| `docs/features/README.md` | Spesifikasi ringkas fitur |
| `docs/product/ROADMAP.md` | Ide setelah MVP |

## Struktur

```text
docs/
  product/      PRD dan roadmap
  design/       design system dan UX flow
  technical/    rencana teknis
  features/     satu folder per fitur MVP
```

Stack berjalan: **React/Vite/TypeScript + Python/FastAPI + SQLAlchemy async/asyncpg**, PostgreSQL/Alembic, Tailwind, Google OAuth via Authlib dan tooling tes. Dependency dipin melalui lockfiles. Adapter Calendar baru diuji simulasi; provider hosting produksi belum dipilih. Kode runtime terpisah dari `docs/`: `backend/` dan `frontend/`.
# MyCalendarManagement
# MySchedule Manager
