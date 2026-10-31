# Frontend — React/Vite

UI akun responsif mengikuti referensi layar Home: kartu kapasitas, catatan Important, agenda mingguan kronologis, dan navigasi mobile/desktop. Pengguna dapat menambah, melihat, mengedit dan menghapus agenda maupun catatan, mengelola checklist, menyelesaikan dan membuka kembali catatan. Home menyapa nama lengkap `name` yang diterima dari Google login, bukan nama contoh atau bagian alamat email. Data berasal dari API akun; tidak ada seed/demo data yang dianggap milik pengguna. Pengingat Google Calendar dan ekspor `.ics` belum aktif.

Identitas ikon **My** berbentuk kalender kertas dengan gradasi biru dipilih pengguna. Master, versi maskable, dan versi favicon ada di `assets-source/icon/`; `public/icons/` memuat favicon 16/32, ikon PWA 192/512 (standar dan maskable), serta ikon Apple 180. `public/manifest.webmanifest`, `index.html`, dan logo aplikasi merujuk aset baru dengan versi URL untuk menyegarkan cache. Ini menyiapkan ikon dan metadata instalasi; dukungan offline/service worker belum ditambahkan.

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

`npm run test:e2e` membangun output produksi dahulu, lalu memakai Vite preview pada port 4173 dan backend test pada 8001, dengan viewport desktop/mobile. Tes authenticated Home memock respons API; tes lainnya memakai backend lokal. `npx playwright install chromium` diperlukan jika browser Playwright belum tersedia; untuk memakai Chrome lokal, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. Emulasi viewport **bukan** pengujian iPhone/Safari atau Google Calendar nyata.

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
- Switch **Mode gelap** terletak setelah Pengaturan; pada navigasi HP berlabel **Tema**. Light adalah default. Jika kategori preferensi diizinkan, cookie `myschedule_theme` menyimpan **preferensi tampilan saja** selama 30 hari; tidak berisi agenda, identitas, token atau kredensial.
- Home/Detail hari meminta `/overview/week?week_start=...&weeks=5`: 35 hari dalam satu request dan satu pembacaan rentang database. Empat minggu berikutnya dipasang ke cache, sehingga tombol berikutnya langsung memakai data yang sudah dimuat.
- Setelah opt-in, snapshot mingguan disimpan di **IndexedDB per akun dan zona waktu**, bukan cookie. Snapshot lebih tua dari 30 hari tidak digunakan, dan dibersihkan saat penulisan berikutnya. Data ini **tidak dienkripsi oleh aplikasi**; gunakan perangkat/browser pribadi. Sesi harus diverifikasi server sebelum cache dibaca. Snapshot ditampilkan saat reload menunggu jaringan, lalu diperbarui; fresh window 60 detik. Ini bukan login offline atau service worker.
- Create/edit/delete menghapus snapshot kapasitas lama dan memperbarui cache resource terkait. BroadcastChannel menyinkronkan invalidasi antar-tab bila tersedia. Logout dan sesi yang terdeteksi berakhir menghapus cache privat; snapshot kedaluwarsa/akun lain tidak ditampilkan. Jika storage diblokir/penuh, aplikasi tetap memakai memori dan API.
- `e2e/workspace-features.spec.ts` menguji CRUD, konflik versi, konfirmasi hapus, tema/cookie, prefetch empat minggu berikutnya, cache saat reload, TTL, pemisahan akun, storage diblokir dan pembersihan logout. Ini emulasi Chromium, belum menggantikan pengujian Safari/iPhone fisik.

## Catatan dan checklist

- Daftar menyediakan pencarian judul/isi dan filter belum selesai, lewat target, selesai, semua. Filter/pencarian berlaku pada maksimal 100 catatan yang dimuat; batas ditampilkan secara eksplisit. Target memakai zona profil, bukan zona browser.
- Detail menampilkan isi dengan paragraf utuh, status/rentang target, Important, progres checklist, dan informasi pengingat/timestamp. **Edit catatan** mengubah rincian/target; **Kelola checklist** membuka langkah yang bisa ditambah, diubah, dihapus, dan diurutkan. Centang lama dipertahankan saat rename/reorder.
- Centang disimpan otomatis setelah konfirmasi server. Perubahan form menunggu **Simpan perubahan**. Semua checklist dicentang tidak otomatis menyelesaikan catatan; catatan tanpa checklist bukan 100%. Checklist tersisa memerlukan konfirmasi penyelesaian; **Buka kembali** mempertahankan centang. Catatan selesai harus dibuka sebelum diedit.
- Hapus memerlukan dialog konfirmasi, tidak menghilangkan data dari UI sebelum server berhasil. Konflik versi mempertahankan draft; muat versi terbaru hanya atas tindakan pengguna. Pengingat/prasyarat yang belum didukung dijelaskan; mapping/relasi lama membatasi tindakan berisiko.
- Mutasi memperbarui detail, daftar dan Home, serta mengirim invalidasi antar-tab tanpa membuang cache minggu kalender. `e2e/notes.spec.ts` menguji alur desktop/mobile dengan API simulasi; backend menguji transaksi/CSRF/owner/konkurensi pada database test nyata.

## Halaman masuk publik

- Halaman Welcome berfokus pada manfaat produk dan satu tindakan **Masuk dengan Google**. Status migrasi/database, label build, callback localhost dan panduan `.env` tidak ditampilkan kepada pengunjung; panduan operasional tetap di README backend.
- Judul utama dan brand mobile menampilkan **MySchedule Manager**. Penjelasan fungsi, penggunaan identitas Google, pengelola/kontak dan kebijakan tersedia dalam HTML awal, bukan hanya `<noscript>` atau setelah pemeriksaan sesi. Tidak ada klaim bahwa pengingat Calendar sudah tersedia.
- Setelah `vite build`, `scripts/prerender-homepage.mjs` merender komponen `Welcome` yang sama melalui `src/prerender.tsx` ke `dist/index.html`. Proses ini anonim, tanpa API, cookie, sesi atau data akun. Jangan melewati script tersebut saat deploy. Konten statis tidak menampilkan kontrol cookie/tema yang belum aktif dan tidak mengklaim layanan masuk siap.
- Client memakai `createRoot`, bukan hydration: konten publik statis diganti dengan state sesi, tema dan consent browser. Tidak ada salinan teks homepage kedua yang harus disinkronkan. Informasi publik tetap tampil saat `/me` tertunda/gagal; workspace dan cache privat tetap memerlukan identitas yang terverifikasi.
- Pemeriksaan sesi dan readiness tetap dilakukan. Loading menonaktifkan masuk; kegagalan layanan memakai pesan publik dan tombol **Coba lagi**, bukan pesan internal server. Parameter error OAuth tidak dipantulkan ke halaman.
- Semua pengguna dapat masuk dengan akun Google; akun baru dibuat otomatis setelah identitas Google terverifikasi. Agenda dan catatan tetap privat per akun. Google OAuth harus memakai Audience **External / In production** agar tidak dibatasi test user oleh Google. Pengingat Calendar/ekspor .ics belum tersedia.
- Preview adalah tangkapan UI aplikasi dengan data sintetis yang diberi label. Tersedia AVIF responsif 720/1200px dengan PNG fallback, mengikuti tema. Sumber aset tercatat di `assets-source/preview-README.md`.
- Kode workspace/editor dipisahkan dan dimuat setelah sesi terverifikasi. Jika pemuatan modul gagal, pengguna mendapat tindakan muat ulang. Lighthouse lokal bukan pengukuran produksi atau jaminan Core Web Vitals.
- Prinsip panduan desain yang diberikan pemilik dirangkum secara kontekstual pada `AGENTS.md`, untuk seluruh frontend tanpa mengganti stack, brand, atau alur data yang sudah bekerja.

## Hari ini dan tindakan tanggal

- Membuka Home tanpa parameter tanggal memilih hari ini dan minggunya menurut zona profil. Tanggal di bawah sapaan selalu menunjukkan hari ini, bukan tanggal yang sedang ditinjau.
- Jam tampilan diperbarui pada pergantian menit, saat tab kembali terlihat/fokus, dan saat halaman dipulihkan browser. Default hari/minggu ikut berganti saat tengah malam; tidak memakai tanggal UTC atau zona browser secara tidak sengaja.
- Link eksplisit `?week=...&date=...` tetap bisa dipakai untuk meninjau tanggal lain. Tombol **Hari ini** kembali ke minggu/tanggal sekarang dan membersihkan pilihan eksplisit agar mengikuti hari berikutnya otomatis.
- Klik blok hari/angka tanggal di Agenda Mingguan untuk memilih hari dan membuka **Tambah agenda** atau **Lihat detail hari**. Form tambah agenda memakai tanggal yang diklik, termasuk pada hari yang sudah memiliki agenda. Escape/tutup mengembalikan fokus ke tombol tanggal.
- `e2e/home-today.spec.ts` menguji zona profil yang berbeda dari browser, reload, pergantian Minggu-Senin, resume perangkat, keyboard dan tanggal form. `e2e/welcome.spec.ts` menguji state publik dan tema tanpa bypass login aplikasi.

## Pilihan cookie dan penyimpanan perangkat

- Cookie sesi/OAuth tetap wajib. `myschedule_storage` mencatat pilihan kategori selama 180 hari, tanpa identitas Google atau isi agenda. Ini bukan persetujuan terhadap ToS dan bukan audit consent di server.
- Preferensi tema dan cache agenda IndexedDB **mati sebelum opt-in**. Tema tetap dapat diubah di memori; prefetch mingguan dan cache query di memori tetap bekerja tanpa izin penyimpanan persisten.
- Pemberitahuan awal berupa bar non-modal di bawah layar Welcome, tanpa backdrop atau pergeseran hero. Ruang di akhir halaman mengikuti tinggi bar agar footer dapat digulir ke atasnya, termasuk setelah resize atau pesan error. Tombol tutup hanya menyembunyikan bar untuk tampilan saat ini, bukan menyimpan izin; penyimpanan opsional tetap mati. **Pengaturan cookie** dapat dibuka lagi dari footer Welcome, halaman legal, atau bagian **Privasi di perangkat** pada Pengaturan akun. Tidak ada kategori iklan/analytics karena aplikasi tidak memasangnya.
- Mematikan opsi membersihkan cookie tema atau cache agenda lokal, termasuk cache lama sebelum ada kontrol consent. Data server tidak dihapus. Pilihan berlaku per browser/domain (bukan per akun), disinkronkan antar-tab, dan gagal tertutup bila penyimpanan pilihan diblokir.
- Pilihan tema yang tidak diizinkan tidak dibaca saat bootstrap. Cache disk tidak dibaca/ditulis tanpa izin; hasil fetch/hydration yang masih berjalan memeriksa ulang izin sebelum menyimpan/memulihkan data.
- Cookie tema berumur 30 hari. Cache lebih tua dari 30 hari tidak digunakan; pembersihan usia cache berjalan saat penulisan berikutnya, bukan timer yang menjamin penghapusan saat situs tidak dibuka. Keluar/penarikan izin membersihkan cache yang dikelola aplikasi.
- `storage-consent.test.ts` dan `e2e/cookie-privacy.spec.ts` menguji default, penolakan, izin per kategori, penarikan, keyboard/fokus, tab dan browser yang memblokir cookie. Tes workspace secara eksplisit mengizinkan disk saat menguji fitur cache persisten.

## Halaman legal rilis

Pemilik menyetujui publikasi dengan identitas **MySchedule Manager**, kontak **maliknahar.mn@gmail.com**, dan penanganan permintaan data/penghapusan akun secara manual. Tanggal berlaku: **29 Oktober 2026**. Penghapusan agenda/catatan masih soft-delete; tidak ada janji penghapusan cadangan seketika atau persetujuan ToS yang tercatat di server.

- Sumber rilis: `privacy/index.html`, `terms/index.html`, `cookies/index.html`. Ketiganya merupakan entry HTML Vite terpisah, bukan route React yang memerlukan login. Build menghasilkan `dist/privacy/index.html`, `dist/terms/index.html`, `dist/cookies/index.html`.
- `src/legal.css` menyediakan layout dokumen, daftar isi, mode terang/gelap dan cetak. `src/legal.tsx` hanya meningkatkan kontrol cookie memakai komponen/pilihan yang sama dengan aplikasi, tanpa request sesi/API. Tanpa JavaScript, seluruh isi dan tautan tetap terbaca; instruksi browser disediakan untuk pengelolaan data situs.
- Welcome, dialog cookie dan Pengaturan akun menautkan dokumen rilis. Navigasi ke dokumen memakai anchor biasa agar HTML statis benar-benar dimuat.
- Jalankan `npm run legal:preview`, lalu buka `http://127.0.0.1:4180/privacy/`. Perintah ini membangun versi produksi dahulu. Jalankan `npm run build` sebelum `npm run legal:test` untuk memeriksa output, tautan/aset, isi rilis dan route allowlist preview.
- `e2e/legal-release.spec.ts` menguji tiga kebijakan tanpa JavaScript/API, anchor daftar isi, kontak, tautan Welcome saat backend gagal, serta pilihan cookie yang konsisten lintas halaman.
- `e2e/welcome.spec.ts` juga memeriksa homepage hasil build tanpa JavaScript, bundle yang diblokir, pemeriksaan sesi yang macet, nama lengkap di mobile, dan kontrol cookie yang tetap dapat dibuka saat menunggu sesi. `legal:test` memeriksa identitas, tujuan, penggunaan data dan tag kepemilikan dalam HTML produksi.
- `legal-drafts/` hanya arsip tinjauan lama, tidak diterbitkan dan bukan sumber rilis. Halaman ini tidak menjamin kepatuhan hukum atau persetujuan Google.
