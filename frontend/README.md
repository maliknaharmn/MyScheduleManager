# Frontend — React/Vite

UI akun responsif mengikuti referensi layar Home: kartu kapasitas, catatan Important, agenda mingguan kronologis, dan navigasi mobile/desktop. Pengguna dapat menambah, melihat, mengedit dan menghapus agenda maupun catatan, mengelola checklist, menyelesaikan dan membuka kembali catatan. Home menyapa nama lengkap `name` yang diterima dari Google login, bukan nama contoh atau bagian alamat email. Data berasal dari API akun; tidak ada seed/demo data yang dianggap milik pengguna. Pengingat Google Calendar dan ekspor `.ics` belum aktif.

Identitas ikon baru dibuat dengan imagegen dari palet UI biru kobalt/lime. Master berada di `assets-source/icon/`; `public/icons/` memuat favicon 16/32, ikon PWA 192/512, dan ikon Apple 180. `public/manifest.webmanifest` serta `index.html` merujuk aset tersebut. Ini menyiapkan ikon dan metadata instalasi; dukungan offline/service worker belum ditambahkan.

Gunakan Node ≥22.12.0. Jalankan dari `frontend/`:

```sh
npm ci
npm run dev
```

Buka **http://localhost:5173**. Jalankan backend di port 8000 terlebih dahulu. Vite memproxy request pada origin yang sama; jangan menaruh Google secret di `VITE_*` atau bundle browser.

```sh
npm test
npm run build
npm run test:e2e
```

E2E memakai port khusus 4173/8001 dan viewport desktop/mobile. Tes authenticated Home memock respons API; tes lainnya memakai backend lokal. `npx playwright install chromium` diperlukan jika browser Playwright belum tersedia; untuk memakai Chrome lokal, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. Emulasi viewport **bukan** pengujian iPhone/Safari atau Google Calendar nyata.

Schema API publik dihasilkan dari OpenAPI FastAPI. Tipe respons fitur baru sementara disusun di `src/api/resources.ts` mengikuti schema tersebut. Dari `backend/` ekspor schema, lalu di folder ini regenerasi tipe OpenAPI:

```sh
npm run api:types
```

Create/update HTTP tidak di-retry otomatis. Draft profil dan expected_version tidak ditimpa background refetch saat pengguna sedang mengedit. Logout mencabut sesi perangkat ini dan membersihkan cache privat; bukan mematikan pengingat Google.

## Alur tambah agenda dan loading

- Form singkat membuka satu tanggal dan saran waktu berdurasi 1 jam, mengikuti zona profil. Tombol 30 menit/1 jam/2 jam mengisi jam selesai; lintas tengah malam ditampilkan sebagai **Selesai besok**, bukan diasumsikan diam-diam untuk jam yang diketik manual.
- **Berulang** membuka tanggal akhir dan pilihan hari; kategori/status/pengingat tetap tersedia di opsi tambahan. Jam dan tanggal yang disarankan bisa diubah sebelum simpan.
- Hasil POST dipakai langsung sebagai detail setelah server mengonfirmasi berhasil. Hanya cache agenda/kapasitas yang di-invalidasi, tanpa menunggu reload sesi atau catatan. Catatan baru memakai pola yang sama.
- Cache resource umum fresh 30 detik; sesi tetap diperiksa saat fokus kembali. Tidak ada retry mutasi otomatis.
- `e2e/agenda-quick-add.spec.ts` menguji form ringkas, save pending/gagal, cache, keyboard, pengulangan, Important, dan tengah malam pada desktop/mobile. API authenticated di tes ini disimulasikan; tes database backend tetap memakai PostgreSQL test terpisah.

## Edit, hapus, tema dan cache bulanan

- Buka detail agenda → **Edit** atau **Hapus**. Edit dan hapus berlaku untuk seluruh agenda/seri berulang, bukan satu kemunculan. Hapus memerlukan konfirmasi dan memakai soft delete di server. `expected_version` mencegah perubahan perangkat lain tertimpa; konflik mempertahankan draft sampai pengguna memilih memuat versi terbaru.
- Tag lain, offset pengingat yang sudah tersimpan, zona waktu dan pola jadwal dipertahankan saat edit. Interval timestamp lama tetap memakai representasi aslinya; editor menyediakan input ISO ber-offset untuk interval tersebut.
- Switch **Mode gelap** terletak setelah Pengaturan; pada navigasi HP berlabel **Tema**. Light adalah default. Cookie `myschedule_theme` menyimpan **preferensi tampilan saja** selama 30 hari; tidak berisi agenda, identitas, token atau kredensial.
- Home/Detail hari meminta `/overview/week?week_start=...&weeks=5`: 35 hari dalam satu request dan satu pembacaan rentang database. Empat minggu berikutnya dipasang ke cache, sehingga tombol berikutnya langsung memakai data yang sudah dimuat.
- Snapshot mingguan disimpan maksimal 30 hari di **IndexedDB per akun dan zona waktu**, bukan cookie. Data ini **tidak dienkripsi oleh aplikasi**; gunakan perangkat/browser pribadi. Sesi harus diverifikasi server sebelum cache dibaca. Snapshot ditampilkan saat reload menunggu jaringan, lalu diperbarui; fresh window 60 detik. Ini bukan login offline atau service worker.
- Create/edit/delete menghapus snapshot kapasitas lama dan memperbarui cache resource terkait. BroadcastChannel menyinkronkan invalidasi antar-tab bila tersedia. Logout dan sesi yang terdeteksi berakhir menghapus cache privat; snapshot kedaluwarsa/akun lain tidak ditampilkan. Jika storage diblokir/penuh, aplikasi tetap memakai memori dan API.
- `e2e/workspace-features.spec.ts` menguji CRUD, konflik versi, konfirmasi hapus, tema/cookie, prefetch empat minggu berikutnya, cache saat reload, TTL, pemisahan akun, storage diblokir dan pembersihan logout. Ini emulasi Chromium, belum menggantikan pengujian Safari/iPhone fisik.

## Catatan dan checklist

- Daftar menyediakan pencarian judul/isi dan filter belum selesai, lewat target, selesai, semua. Filter/pencarian berlaku pada maksimal 100 catatan yang dimuat; batas ditampilkan secara eksplisit. Target memakai zona profil, bukan zona browser.
- Detail menampilkan isi dengan paragraf utuh, status/rentang target, Important, progres checklist, dan informasi pengingat/timestamp. **Edit catatan** mengubah rincian/target; **Kelola checklist** membuka langkah yang bisa ditambah, diubah, dihapus, dan diurutkan. Centang lama dipertahankan saat rename/reorder.
- Centang disimpan otomatis setelah konfirmasi server. Perubahan form menunggu **Simpan perubahan**. Semua checklist dicentang tidak otomatis menyelesaikan catatan; catatan tanpa checklist bukan 100%. Checklist tersisa memerlukan konfirmasi penyelesaian; **Buka kembali** mempertahankan centang. Catatan selesai harus dibuka sebelum diedit.
- Hapus memerlukan dialog konfirmasi, tidak menghilangkan data dari UI sebelum server berhasil. Konflik versi mempertahankan draft; muat versi terbaru hanya atas tindakan pengguna. Pengingat/prasyarat yang belum didukung dijelaskan; mapping/relasi lama membatasi tindakan berisiko.
- Mutasi memperbarui detail, daftar dan Home, serta mengirim invalidasi antar-tab tanpa membuang cache minggu kalender. `e2e/notes.spec.ts` menguji alur desktop/mobile dengan API simulasi; backend menguji transaksi/CSRF/owner/konkurensi pada database test nyata.
