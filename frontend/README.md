# Frontend — React/Vite

Fondasi UI login/configuration dan shell akun dengan profil yang benar-benar tersimpan di server. Overview/agenda/catatan saat ini **belum diimplementasikan** dan diberi label jelas; tidak ada seed/demo data yang dianggap milik pengguna.

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

E2E memakai port khusus 4173/8001, backend sungguhan dan viewport desktop/mobile. `npx playwright install chromium` diperlukan jika browser Playwright belum tersedia; untuk memakai Chrome lokal, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. Emulasi viewport **bukan** pengujian iPhone/Safari atau Google Calendar nyata.

Tipe API dihasilkan dari OpenAPI FastAPI, bukan menyalin model ORM. Dari `backend/` ekspor schema, lalu di folder ini:

```sh
npm run api:types
```

Create/update HTTP tidak di-retry otomatis. Draft profil dan expected_version tidak ditimpa background refetch saat pengguna sedang mengedit. Logout mencabut sesi perangkat ini dan membersihkan cache privat; bukan mematikan pengingat Google.
