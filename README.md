# MySchedule Manager

**Status:** paket pra-build dan default **disetujui**; lanjut fondasi lokal dan risk spike. Aplikasi belum di-scaffold pada pencatatan approval; integrasi/tes/pilot belum terbukti.

MySchedule Manager membantu satu pengguna melihat kapasitas jadwal pribadi, mencatat komitmen cepat, serta memantau catatan bertarget dengan checklist dan prasyarat terhubung. Produk ini adalah **personal schedule overview dan decision-support tool**, bukan pengganti seluruh Google Calendar. Keputusan menerima tawaran tetap dibuat pengguna di luar aplikasi.

MVP adalah web app responsif/PWA untuk iPhone Home Screen dan browser Mac, **Google login saja**, dengan data yang tersinkron otomatis. Kapasitas berdasarkan jam: Free 0, Light >0–<6, Medium 6–10, Busy >10; Tentative ikut dihitung. Pengingat catatan harian memakai integrasi Google Calendar terbatas dan berhenti otomatis saat selesai; agenda dapat diekspor `.ics` satu arah. Input bahasa alami ditunda. Nama folder kerja `MyCalender Manager` dipertahankan; nama produk **MySchedule Manager**.

Pipeline kini: **fondasi lokal + risk spike → implementasi → QA/pilot**. PRD, stack baseline, ERD/API, wireframe dan U01–U10 diterima; sumber [Approval](docs/product/APPROVAL.md). Provider hosting, credentials, biaya dan deployment bukan persetujuan tersirat.

## Mulai dari sini

| Dokumen                                            | Isi                                                          |
| -------------------------------------------------- | ------------------------------------------------------------ |
| [Discovery](docs/product/DISCOVERY.md)             | Dasar jawaban pengguna dan riwayat keputusan                 |
| [PRD](docs/product/PRD.md)                         | Masalah, ruang lingkup MVP, kebutuhan, dan keputusan terbuka |
| [UX Flow](docs/design/UX_FLOW.md)                  | Navigasi dan alur keputusan serta penambahan jadwal          |
| [Design System](docs/design/DESIGN_SYSTEM.md)      | Prinsip visual, komponen, dan aksesibilitas                  |
| [Technical Plan](docs/technical/TECHNICAL_PLAN.md) | Model data, batas arsitektur, serta urutan implementasi      |
| [ERD](docs/technical/ERD.md)                      | Usulan tabel, relasi, dan constraint data                   |
| [API Contract](docs/technical/API_CONTRACT.md)    | Endpoint React–FastAPI, payload, error, dan status pengingat |
| [Wireframes](docs/design/WIREFRAMES.md)           | Seluruh layar, form, state, dialog dan responsif             |
| [Build Handoff](docs/technical/BUILD_HANDOFF.md)  | Mulai review seluruh paket dan keputusan sebelum build     |
| [Backlog](docs/technical/IMPLEMENTATION_BACKLOG.md) | 30 tiket implementasi beserta dependency dan acceptance   |
| [QA Plan](docs/technical/QA_PLAN.md)              | 38 test case rencana dan traceability 22 acceptance          |
| [Fitur MVP](docs/features/README.md)               | Spesifikasi ringkas per fitur                                |
| [Roadmap](docs/product/ROADMAP.md)                 | Ide setelah MVP; bukan cakupan build saat ini                |

## Struktur

```text
docs/
  product/      PRD dan roadmap
  design/       design system dan UX flow
  technical/    rencana teknis
  features/     satu folder per fitur MVP
```

Stack baseline disetujui: **React/Vite/TypeScript + Python/FastAPI + SQLAlchemy async/asyncpg**, PostgreSQL/Alembic, Tailwind/shadcn, Google OAuth via Authlib, Calendar API, pytest/Playwright. Detail di Technical Plan; dependency belum diinstal dan provider hosting belum dipilih. Kode runtime terpisah dari `docs/`: `backend/` dan `frontend/`.
# MyCalendarManagement
# MySchedule Manager
