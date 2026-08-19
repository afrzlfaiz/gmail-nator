# Gmail Nator

Gmail Nator adalah public temporary inbox berbasis Gmail alias. Aplikasi dapat memakai banyak Gmail source, memilih source secara acak, menerima alias mixed dot-plus, dan menerima custom domain yang diteruskan ke Gmail melalui Cloudflare Email Routing.

## Arsitektur Singkat

```text
Pengunjung
    |
    v
Next.js public UI  ---- /api ----> Express API
                                      |
                                      +--> PostgreSQL / Supabase
                                      +--> Gmail API poller per source
                                      +--> Admin API dan OAuth callback

Email custom-domain --> Cloudflare Email Routing --> Gmail source
                                                  --> Gmail API poller
```

Komponen utama:

- Public UI: `/`
- Admin UI: `/admin`
- Backend API: Express di `/api/*`
- OAuth callback: `/oauth2/callback`
- Database: PostgreSQL, direkomendasikan Supabase Session Pooler
- Polling: Gmail History API per Gmail source
- Forwarding custom domain: Cloudflare Email Routing yang dikonfigurasi manual

## Prasyarat

Siapkan:

- Node.js 22 atau lebih baru
- npm
- Git
- OpenSSL untuk membuat encryption key
- Project Google Cloud
- Database PostgreSQL
- Akun Gmail source yang akan menerima email
- Akun Cloudflare dan domain aktif jika memakai custom domain

Production wajib memakai PostgreSQL. Tanpa `DATABASE_URL`, aplikasi menolak untuk berjalan. Local development juga memakai database yang sama melalui Supabase Session Pooler.

## 1. Google Cloud Console

Bagian ini hanya perlu dilakukan satu kali untuk membuat OAuth application credentials. Source Gmail yang sebenarnya tetap ditambahkan dari `/admin`.

### 1.1 Buat project Google Cloud

1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Pilih project dari project selector di bagian atas.
3. Klik **New Project**.
4. Isi nama project, misalnya `gmail-nator-production`.
5. Klik **Create**.
6. Pastikan project baru sudah terpilih sebelum melanjutkan.

### 1.2 Aktifkan Gmail API

1. Buka **APIs & Services** > **Library**.
2. Cari **Gmail API**.
3. Buka hasil **Gmail API** resmi dari Google.
4. Klik **Enable**.

Direct link: [Gmail API Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com).

### 1.3 Konfigurasi OAuth consent screen

Google dapat menampilkan menu dengan nama **Google Auth Platform** pada console baru. Pada console lama, bagian ini disebut **OAuth consent screen**.

1. Buka **Google Auth Platform** atau **APIs & Services** > **OAuth consent screen**.
2. Pada **Branding**, isi app name, user support email, dan developer contact information.
3. Pada **Audience**:
   - Pilih **External** jika source Gmail bukan hanya akun dalam satu Google Workspace organization.
   - Pilih **Internal** hanya jika semua source berada dalam Google Workspace organization yang sama dan opsi tersebut tersedia.
4. Jika memakai mode **Testing** dan audience **External**, tambahkan setiap alamat Gmail source sebagai **Test user**.
5. Pada **Data Access** atau **Scopes**, tambahkan:

```text
https://www.googleapis.com/auth/gmail.readonly
```

6. Simpan konfigurasi.

Scope Gmail adalah scope sensitif atau restricted menurut kebijakan Google. Untuk development, akun source harus ada di daftar test users. Untuk penggunaan production yang lebih luas, ikuti proses publishing dan verification yang diminta Google.

Catatan mode Testing:

- Refresh token external app yang masih Testing dapat memiliki masa berlaku terbatas.
- Jika source berstatus `reauth_required`, lakukan reconnect dari admin panel.
- Untuk production, publish OAuth app dan selesaikan verification Google jika diwajibkan.

### 1.4 Buat OAuth Client ID

1. Buka **Google Auth Platform** > **Clients**, atau **APIs & Services** > **Credentials**.
2. Klik **Create Credentials** > **OAuth client ID**.
3. Pilih application type **Web application**.
4. Isi nama client, misalnya `Gmail Nator Web`.
5. Tambahkan **Authorized redirect URI**.

Untuk local development:

```text
http://localhost:4000/oauth2/callback
```

Untuk production:

```text
https://YOUR_PUBLIC_HOST/oauth2/callback
```

Redirect URI harus sama persis dengan `GMAIL_REDIRECT_URI`, termasuk scheme, hostname, port, path, dan trailing slash. Jangan memakai `/admin` sebagai redirect URI.

Saat tombol **Connect OAuth** digunakan, aplikasi meminta `access_type=offline` dan `prompt=consent` agar Google mengembalikan refresh token untuk polling background.

6. Klik **Create**.
7. Simpan **Client ID** dan **Client secret** untuk environment aplikasi.
8. Jangan commit client secret atau file JSON credentials ke repository.

Dokumentasi Google: [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server).

## 2. Database Supabase

Supabase dipakai sebagai PostgreSQL. Backend menggunakan `pg.Pool` secara langsung, bukan Supabase client, sehingga `SUPABASE_URL`, anon key, dan service-role key tidak diperlukan.

### 2.1 Buat project

1. Buka [Supabase Dashboard](https://supabase.com/dashboard).
2. Buat project baru atau pilih project yang sudah ada.
3. Simpan database password project.

### 2.2 Jalankan migration

Buka **SQL Editor**, lalu jalankan file secara berurutan:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_admin_sources_domains.sql`

Migration kedua membuat:

- `gmail_sources`
- `admin_credentials`
- `admin_sessions`
- `oauth_states`
- `custom_domains`
- Kolom source/domain pada mailbox
- Checkpoint dan deduplikasi pesan per Gmail source

### 2.3 Ambil Session Pooler URI

1. Buka halaman project Supabase.
2. Klik **Connect**.
3. Pilih **Session pooler**.
4. Gunakan connection string dengan port `5432`.

Contoh:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Gunakan port `5432`, bukan transaction pooler port `6543`, karena backend menggunakan persistent `pg.Pool`. Jika password berisi karakter khusus seperti `@`, `#`, atau `/`, URL-encode password tersebut.

## 3. Environment Variables

Buat file local:

```bash
cp .env.example .env
```

Isi `.env` dengan konfigurasi berikut:

```env
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=
BACKEND_URL=

DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

GMAIL_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=YOUR_CLIENT_SECRET
GMAIL_REDIRECT_URI=http://localhost:4000/oauth2/callback

GMAIL_TOKEN_ENCRYPTION_KEY=PASTE_OUTPUT_OF_OPENSSL_HERE

ADMIN_INITIAL_PASSWORD=USE_A_LONG_RANDOM_PASSWORD_HERE
ADMIN_PASSWORD_HASH=
ADMIN_APP_URL=http://localhost:3000
ADMIN_SESSION_TTL_HOURS=12

POLL_INTERVAL_MS=10000
MESSAGE_RETENTION_DAYS=7
MAX_MESSAGES_PER_MAILBOX=20
```

### 3.1 Buat encryption key

Jalankan:

```bash
openssl rand -hex 32
```

Salin hasilnya ke `GMAIL_TOKEN_ENCRYPTION_KEY`. Hasilnya harus berupa 64 karakter hexadecimal, yaitu 32 byte.

Penting:

- Key ini dipakai untuk mengenkripsi refresh token Gmail di database.
- Jangan commit key ke Git.
- Jangan mengganti key setelah token tersimpan kecuali semua token sudah didekripsi dan dienkripsi ulang dengan key baru.
- Kehilangan key membuat token lama tidak dapat dipakai dan semua source harus dihubungkan ulang.

### 3.2 Password admin

Cara paling mudah untuk first setup:

```env
ADMIN_INITIAL_PASSWORD=isi-password-minimal-12-karakter
```

Saat login pertama, password akan di-hash menggunakan `crypto.scrypt` dan disimpan di `admin_credentials`. Setelah berhasil login, hapus `ADMIN_INITIAL_PASSWORD` dari environment deployment dan lakukan redeploy.

`ADMIN_PASSWORD_HASH` dapat dipakai sebagai alternatif bootstrap jika hash password sudah disiapkan sebelumnya. Database credential yang sudah ada menjadi sumber utama setelah bootstrap pertama.

### 3.3 Variable local dan production

| Variable | Local | Production |
| --- | --- | --- |
| `DATABASE_URL` | Supabase atau PostgreSQL local | Wajib PostgreSQL persistent |
| `CORS_ORIGIN` | `http://localhost:3000` | URL frontend publik |
| `GMAIL_REDIRECT_URI` | `http://localhost:4000/oauth2/callback` | `https://HOST/oauth2/callback` |
| `ADMIN_APP_URL` | `http://localhost:3000` | Kosong untuk integrated app, atau URL frontend terpisah |
| `NEXT_PUBLIC_API_URL` | Kosong jika memakai rewrite | Kosong untuk integrated app |
| `BACKEND_URL` | Kosong jika backend port 4000 | Kosong untuk integrated app |

`GMAIL_SOURCE_EMAIL` dan `GMAIL_REFRESH_TOKEN` tidak dibutuhkan untuk setup baru. Source dan refresh token dimasukkan dari `/admin`.

## 4. Jalankan Local

Install dependency dan jalankan frontend serta backend:

```bash
npm install
npm run dev:all
```

URL local:

- Public UI: `http://localhost:3000`
- Admin UI: `http://localhost:3000/admin`
- Backend health: `http://localhost:4000/api/health`

Cek health:

```bash
curl http://localhost:4000/api/health
```

Response awal akan menunjukkan `gmailRelayReady: false` sampai ada source yang berhasil terhubung dan selesai melakukan polling pertama.

Untuk menjalankan service secara terpisah:

Terminal 1:

```bash
npm run backend:dev
```

Terminal 2:

```bash
npm run dev
```

## 5. Setup Admin dan Gmail Sources

### 5.1 Login admin

1. Buka `http://localhost:3000/admin`.
2. Masukkan `ADMIN_INITIAL_PASSWORD`.
3. Password tidak dikirim atau disimpan di browser.
4. Session memakai cookie `HttpOnly` dan disimpan sebagai hash di database.

### 5.2 Tambah source dengan OAuth

Untuk setiap akun Gmail yang ingin dipakai sebagai source:

1. Pada bagian **Gmail sources**, isi alamat Gmail, contoh `source-one@gmail.com`.
2. Isi label opsional.
3. Biarkan refresh token kosong.
4. Klik **Add source**.
5. Klik **Connect OAuth**.
6. Login ke akun Google yang sama persis dengan alamat source.
7. Setujui scope Gmail readonly.
8. Setelah callback selesai, browser kembali ke `/admin`.
9. Pastikan source berstatus `active` dan `token saved`.

Email Google yang melakukan OAuth harus sama dengan email source yang didaftarkan. Callback memanggil `users.getProfile()` dan menolak jika berbeda.

Ulangi langkah tersebut untuk semua Gmail source. Setiap source dipoll dengan instance poller terpisah. Error atau revoked token pada satu source tidak mematikan source lainnya.

### 5.3 Tambah source dengan refresh token yang sudah ada

Jika sudah memiliki refresh token:

1. Isi email source.
2. Isi refresh token pada field **Refresh token (optional)**.
3. Klik **Add source**.
4. Pastikan `GMAIL_TOKEN_ENCRYPTION_KEY` sudah diisi.
5. Tunggu status source berubah setelah poller mencoba koneksi.

Pada production, refresh token dikirim ke API admin melalui HTTPS dan langsung dienkripsi sebelum ditulis ke database. Local development memakai `localhost`; jangan membuka admin melalui koneksi HTTP publik. Token tidak pernah dikembalikan pada response admin.

### 5.4 Migrasi source lama

Variable environment `GMAIL_SOURCE_EMAIL` dan `GMAIL_REFRESH_TOKEN` sudah dihapus dari aplikasi. Untuk migrasi, tambahkan source secara manual di `/admin` dan masukkan refresh token lama pada field **Refresh token (optional)**; token akan dienkripsi sebelum disimpan.

### 5.5 Status source

- `pending`: source sudah dibuat tetapi belum memiliki token.
- `active`: source diaktifkan dan poller berjalan.
- `disabled`: source sengaja dimatikan dari admin panel.
- `reauth_required`: token ditolak atau akses dicabut oleh Google.
- `error`: source gagal diinisialisasi atau polling mengalami error.

Source baru dipilih secara acak oleh generator jika statusnya aktif dan poller sudah ready. Source dengan status `active` yang belum selesai polling belum langsung tersedia untuk generator.

## 6. Alias Gmail

Generator publik memilih Gmail source aktif secara acak setiap mailbox dibuat.

Tipe yang tersedia:

- Dot trick: `a.h.mad.rizal@gmail.com`
- Plus trick: `ahmadrizal+abc123@gmail.com`
- Mixed trick: `a.h.mad.rizal+abc123@gmail.com`

Mixed alias menggabungkan titik pada local part dan tag setelah `+`. Frontend membuat alias dari source/domain yang ready; server tetap memvalidasi alias saat user membuka mailbox.

Generate dilakukan sepenuhnya di frontend dan tidak membuat request atau record database. Address baru dikirim ke server hanya setelah user klik **Go to mailbox**. History yang ditampilkan browser dibatasi 20 entry; jumlah alias yang dapat dibuat tidak dibatasi oleh aksi generate.

## 7. Custom Domain dan Cloudflare Email Routing

Custom domain tidak memakai Cloudflare API dari aplikasi. Admin hanya memasukkan domain dan memilih Gmail destination; DNS dan Email Routing dikonfigurasi manual di Cloudflare.

### 7.1 Tambahkan domain di admin panel

1. Pastikan Gmail source tujuan sudah berstatus `active` dan ready.
2. Buka `/admin`.
3. Pada **Custom domains**, isi domain tanpa `https://`, contoh `mail.example.com` atau `example.com`.
4. Pilih Gmail destination.
5. Klik **Add domain**.
6. Biarkan domain enabled setelah DNS Cloudflare siap.

Satu custom domain dipetakan ke satu Gmail source. Jika ingin memakai beberapa Gmail source dengan forwarding manual sederhana, gunakan domain berbeda untuk tiap source. Routing beberapa source pada satu domain membutuhkan routing logic tambahan di Cloudflare.

### 7.2 Onboard domain di Cloudflare

1. Login ke [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Tambahkan domain ke Cloudflare jika belum ada.
3. Pastikan nameserver domain sudah menunjuk ke Cloudflare.
4. Buka domain tersebut.
5. Buka **Email** > **Email Routing**, atau **Compute** > **Email Service** > **Email Routing** tergantung tampilan dashboard.
6. Pilih **Onboard Domain**.
7. Ikuti instruksi Cloudflare untuk menambahkan record DNS yang ditampilkan.
8. Cloudflare biasanya menyiapkan MX untuk inbound mail serta TXT untuk SPF/DKIM. Jangan menebak nilai record; gunakan nilai yang ditampilkan pada dashboard.
9. Jika domain sudah memiliki MX dari mail provider lain, selesaikan konflik tersebut terlebih dahulu. Email Routing Cloudflare membutuhkan MX inbound yang mengarah ke server Cloudflare.
10. Tunggu propagasi DNS.

Dokumentasi Cloudflare menyebut propagasi DNS biasanya memerlukan beberapa menit, tetapi waktu aktual bergantung pada TTL dan registrar.

### 7.3 Verifikasi Gmail destination

1. Pada Cloudflare Email Routing, buka **Destination addresses**.
2. Tambahkan Gmail source yang dipilih di admin panel.
3. Buka email verifikasi yang dikirim Cloudflare pada Gmail tersebut.
4. Klik link verifikasi.
5. Pastikan alamat destination berstatus verified.

### 7.4 Buat catch-all forwarding

1. Buka bagian **Routing rules** atau **Catch-all address**.
2. Aktifkan catch-all untuk domain.
3. Pilih action untuk meneruskan email ke Gmail destination yang sudah verified.
4. Simpan rule.
5. Pastikan rule tidak hanya menangkap satu alamat tertentu. Generator custom membutuhkan catch-all agar alamat acak tetap diteruskan.

### 7.5 Uji forwarding

1. Buka public UI.
2. Pilih **Custom domain**.
3. Klik **Generate new alias**.
4. Salin alamat yang dihasilkan, misalnya `tag123456@mail.example.com`.
5. Kirim email uji dari alamat email lain, bukan dari Gmail destination yang sama.
6. Pastikan email masuk ke Gmail source.
7. Tunggu satu interval polling.
8. Buka mailbox custom pada public UI.
9. Pastikan pesan tampil dan recipient menunjukkan alamat custom asli.

Periksa MX jika email tidak masuk:

```bash
dig MX example.com
```

Header recipient penting karena Gmail destination menerima email hasil forwarding. Parser aplikasi mencoba membaca header berikut:

```text
X-Original-Recipient
Delivered-To
X-Original-To
Envelope-To
To
Cc
```

Jika email sudah masuk ke Gmail tetapi mailbox aplikasi tetap kosong, buka Gmail **Show original** dan periksa apakah alamat custom asli masih ada pada salah satu header tersebut. Jika semua header hanya berisi alamat Gmail destination, aplikasi tidak dapat menentukan mailbox custom yang benar tanpa mekanisme forwarding tambahan yang mempertahankan envelope recipient.

Dokumentasi Cloudflare: [Route emails with Email Routing](https://developers.cloudflare.com/email-service/get-started/route-emails/) dan [Configure Email Routing domains](https://developers.cloudflare.com/email-service/configuration/domains/).

## 8. Deployment ke Render

Render Blueprint tersedia pada `render.yaml`.

### 8.1 Persiapan

Sebelum deploy:

1. Jalankan kedua migration di database production.
2. Pastikan OAuth client memiliki redirect URI production.
3. Siapkan `DATABASE_URL` Session Pooler port `5432`.
4. Buat encryption key baru untuk production.
5. Siapkan password admin production yang berbeda dari local.

### 8.2 Buat service

1. Push repository ke GitHub.
2. Buka [Render Dashboard](https://dashboard.render.com/).
3. Pilih **New** > **Blueprint** atau buat Web Service dari repository.
4. Gunakan command berikut jika mengatur service manual:

```text
Build command: npm ci && npm run build:all
Start command: npm run backend:start
Health check path: /api/health
```

### 8.3 Environment Render

Set variable berikut di Render:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
CORS_ORIGIN=https://YOUR_PUBLIC_HOST

GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=https://YOUR_PUBLIC_HOST/oauth2/callback
GMAIL_TOKEN_ENCRYPTION_KEY=...

ADMIN_INITIAL_PASSWORD=USE_A_PRODUCTION_PASSWORD
ADMIN_PASSWORD_HASH=
ADMIN_APP_URL=
ADMIN_SESSION_TTL_HOURS=12

POLL_INTERVAL_MS=10000
MESSAGE_RETENTION_DAYS=7
MAX_MESSAGES_PER_MAILBOX=20
```

Untuk integrated Render service, frontend dan backend berada pada host yang sama sehingga `ADMIN_APP_URL` dapat dikosongkan. Callback akan redirect relatif ke `/admin`.

Jika frontend dan backend memakai host berbeda:

- `CORS_ORIGIN` harus berisi origin frontend, contoh `https://app.example.com`.
- `ADMIN_APP_URL` harus berisi URL frontend, contoh `https://app.example.com`.
- `BACKEND_URL` diisi saat build frontend.
- `NEXT_PUBLIC_API_URL` diisi jika browser harus memanggil backend secara langsung.
- Redirect URI Google harus menunjuk ke backend, contoh `https://api.example.com/oauth2/callback`.

### 8.4 Setelah deploy

1. Buka `https://YOUR_PUBLIC_HOST/api/health`.
2. Pastikan response HTTP `200`.
3. Buka `https://YOUR_PUBLIC_HOST/admin`.
4. Login dengan password bootstrap.
5. Tambahkan dan hubungkan Gmail source.
6. Hapus `ADMIN_INITIAL_PASSWORD` dari Render setelah login pertama, lalu redeploy.
7. Tambahkan custom domain dan konfigurasi Cloudflare.

## 9. Deployment Docker

Build image:

```bash
docker build -t gmail-nator .
```

Jalankan local dengan environment file:

```bash
docker run --rm \
  --env-file .env \
  -e PORT=10000 \
  -p 10000:10000 \
  gmail-nator
```

Dockerfile memakai `node:22-alpine` dan menjalankan `node dist-server/main.js`. File `.env`, migration SQL, dan `node_modules` tidak disalin ke image. Jalankan migration pada database production sebelum container dimulai.

## 10. GitHub Actions dan Image Registry

Workflow yang tersedia:

- `.github/workflows/ci.yml`: typecheck dan build.
- `.github/workflows/docker-publish.yml`: build dan publish image ke GitHub Container Registry.

Image:

```text
ghcr.io/afrzlfaiz/gmail-nator
```

Tag yang dipublish:

- `latest` untuk push ke `main`
- `vX.Y.Z` untuk semantic version tag
- `sha-<long-sha>` untuk commit SHA

Workflow Docker dapat memicu deploy Render jika repository secret `RENDER_DEPLOY_HOOK` sudah diisi dengan Deploy Hook dari Render.

## 11. Verifikasi Development

Jalankan semua pemeriksaan:

```bash
npm test
npm run typecheck
npm run build:all
```

Smoke check backend:

```bash
curl http://localhost:4000/api/health
```

Endpoint utama:

- `GET /api/health`
- `POST /api/admin/login`
- `GET /api/admin/sources`
- `POST /api/admin/sources`
- `POST /api/admin/sources/:id/connect`
- `GET /api/admin/domains`
- `POST /api/admin/domains`
- `POST /api/mailboxes` dengan `{ "type": "dot", "address": "..." }`
- `POST /api/mailboxes` dengan `{ "type": "plus", "address": "..." }`
- `POST /api/mailboxes` dengan `{ "type": "mixed", "address": "..." }`
- `POST /api/mailboxes` dengan `{ "type": "custom", "address": "..." }`
- `GET /api/mailboxes/:address/messages`
- `DELETE /api/messages/:id`

## 12. Troubleshooting

### `GMAIL_RELAY_NOT_READY`

Periksa:

- Gmail source sudah ditambahkan di `/admin`.
- OAuth sudah selesai dan email Google sesuai source.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, dan `GMAIL_REDIRECT_URI` benar.
- `GMAIL_TOKEN_ENCRYPTION_KEY` tersedia.
- Source tidak berstatus `disabled`, `reauth_required`, atau `error`.
- Backend sudah melakukan polling pertama.

### `redirect_uri_mismatch`

Pastikan nilai `GMAIL_REDIRECT_URI` sama persis dengan Authorized redirect URI pada Google Cloud OAuth client. Periksa protocol, hostname, port, path, dan trailing slash.

### Source berstatus `reauth_required`

Token kemungkinan dicabut, expired, atau Google mengembalikan `invalid_grant`.

1. Buka `/admin`.
2. Klik **Reconnect** pada source.
3. Login dengan akun Google yang benar.
4. Setujui scope Gmail readonly.

### Source berstatus `error`

Baca `lastError` pada admin panel dan log backend. Penyebab umum:

- Encryption key berbeda dari key saat token disimpan.
- Gmail API belum diaktifkan.
- OAuth client secret salah.
- Refresh token invalid.
- Account policy Google Workspace memblokir aplikasi.
- Database migration belum dijalankan.

### Custom domain sudah diteruskan tetapi mailbox kosong

Periksa:

- MX domain menunjuk ke Cloudflare.
- Destination Gmail sudah verified di Cloudflare.
- Catch-all rule aktif.
- Email test berasal dari alamat eksternal.
- Recipient custom asli masih ada pada header Gmail **Show original**.
- Domain di admin panel enabled dan terhubung ke source yang ready.

### `DATABASE_URL` error

Periksa:

- Gunakan Session Pooler port `5432`, bukan transaction pooler port `6543`.
- Password sudah URL-encoded.
- Database menerima koneksi dari service deployment.
- Kedua migration sudah dijalankan.

## 13. Keamanan Production

- Jangan commit `.env`, Google client secret, refresh token, admin password, atau `GMAIL_TOKEN_ENCRYPTION_KEY`.
- Gunakan HTTPS untuk public app, admin, OAuth callback, dan API.
- Gunakan password admin yang unik dan panjang.
- Hapus `ADMIN_INITIAL_PASSWORD` setelah bootstrap.
- Simpan backup encryption key di password manager atau secret manager.
- Jangan gunakan temporary mailbox untuk OTP, password, data pribadi, atau data production.
- Public mailbox memang dapat dibaca oleh siapa saja yang mengetahui alamatnya.
- Gmail scope yang dipakai aplikasi adalah readonly; aplikasi tidak menghapus atau mengirim email dari Gmail source.

## Referensi Resmi

- [Google Cloud Console](https://console.cloud.google.com/)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Google OAuth 2.0 Web Server](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-service/get-started/route-emails/)
- [Cloudflare Email Routing Domains](https://developers.cloudflare.com/email-service/configuration/domains/)
