# PRD: Temp-Mail Generator — Gmail Alias Trick

**Versi:** 1.1 (Simplified MVP)  
**Tanggal:** 19 Agustus 2026  
**Target Deploy:** Render  
**Database:** Supabase (PostgreSQL)  
**Status:** MVP / Prototype

---

## 1. Ringkasan Produk

Temp-Mail Generator adalah aplikasi web sederhana untuk membuat alamat email sementara menggunakan mekanisme alias Gmail tanpa membuat inbox Gmail baru.

Aplikasi memanfaatkan dua variasi alamat Gmail:

- **Dot trick** — menyisipkan titik pada bagian local-part alamat Gmail.
- **Plus trick** — menambahkan suffix `+tag` sebelum `@gmail.com`.

Semua email yang dikirim ke alamat hasil generate tetap masuk ke satu akun Gmail sumber milik operator. Backend membaca email melalui Gmail API, mencocokkan alamat penerima dengan mailbox yang telah dibuat, kemudian menyimpan pesan ke Supabase.

Mailbox bersifat **publik**. Siapa pun yang mengetahui alamat mailbox dapat membukanya melalui URL.

Contoh:

```text
/mailbox/#namemail+abc123@gmail.com
```

Setiap mailbox hanya menyimpan **20 pesan terbaru**. Jika pesan ke-21 masuk, pesan paling lama otomatis dihapus. Pesan juga memiliki masa retensi maksimal **7 hari**.

---

## 2. Latar Belakang

Developer, QA tester, dan pengguna umum sering membutuhkan alamat email berbeda untuk pengujian signup, verifikasi akun, maupun menghindari penggunaan alamat utama secara langsung.

Membangun layanan temporary email konvensional membutuhkan domain, konfigurasi DNS/MX, SMTP receiver, dan pengelolaan mail server. Untuk MVP, kebutuhan tersebut dapat dihindari dengan memanfaatkan normalisasi alamat Gmail dan Gmail API.

Produk ini berfokus pada implementasi sesederhana mungkin dengan satu akun Gmail sumber dan penyimpanan inbox virtual pada database.

---

## 3. Tujuan

Tujuan utama aplikasi:

1. Pengguna dapat membuat alamat Gmail alias sekali klik.
2. Pengguna dapat memilih antara **Dot Trick** dan **Plus Trick**.
3. Email masuk dapat tampil pada mailbox virtual dalam waktu sekitar 10–15 detik.
4. Mailbox dapat dibuka kembali menggunakan URL berbasis alamat email.
5. Mailbox tidak memerlukan login atau access token.
6. Setiap mailbox hanya menyimpan maksimal 20 pesan terbaru.
7. Pesan lebih lama dari 7 hari otomatis dihapus.
8. Infrastruktur MVP tetap sederhana dan murah untuk dijalankan.

---

## 4. Non-Goals MVP

Fitur berikut tidak termasuk versi awal:

- Multi akun Gmail sumber.
- Login atau registrasi pengguna.
- Private mailbox.
- Pengiriman email keluar.
- Provider selain Gmail.
- Supabase Realtime.
- Gmail Push Notification / Pub/Sub.
- Attachment proxy penuh.
- Custom domain email.
- Load balancing pool Gmail.
- Quota management kompleks.
- Dashboard admin lengkap.

---

## 5. Target Pengguna

Produk ditujukan untuk:

- Developer yang menguji signup flow.
- QA tester yang membutuhkan beberapa alamat berbeda.
- Pengguna yang membutuhkan alamat sementara untuk registrasi layanan tertentu.
- Developer yang membutuhkan inbox sederhana untuk pengujian OTP atau verification email.

Pengguna harus memahami bahwa mailbox pada MVP bersifat publik.

---

## 6. Alur Utama Pengguna

### 6.1 Generate Mailbox

1. Pengguna membuka halaman utama.
2. Pengguna memilih jenis alias melalui toggle:

```text
[ Dot Trick ] [ Plus Trick ]
```

3. Pengguna menekan tombol **Generate Email**.
4. Backend membuat alamat alias baru berdasarkan akun Gmail sumber.
5. Backend memastikan alamat belum terdaftar pada database.
6. Mailbox disimpan ke tabel `mailboxes`.
7. Frontend menampilkan alamat beserta tombol copy.
8. Pengguna dapat langsung membuka mailbox.

Contoh hasil:

```text
Dot Trick:
a.hmadrizal@gmail.com
ah.mad.rizal@gmail.com

Plus Trick:
ahmadrizal+x8k29a@gmail.com
ahmadrizal+9mx2qp@gmail.com
```

---

## 7. URL Mailbox

Mailbox dapat diakses melalui format:

```text
/mailbox/#alamat@gmail.com
```

Contoh:

```text
/mailbox/#ahmadrizal+x82ka@gmail.com
```

Frontend membaca bagian URL fragment menggunakan JavaScript:

```js
const address = decodeURIComponent(
  window.location.hash.slice(1)
);
```

Alamat tersebut kemudian digunakan untuk meminta daftar pesan ke backend.

Mailbox tidak memiliki password maupun access token.

Konsekuensi desain:

> Siapa pun yang mengetahui alamat mailbox dapat membaca isi mailbox tersebut.

Karakteristik tersebut dianggap sebagai bagian dari desain MVP.

---

## 8. Riwayat Mailbox di Browser

Mailbox yang pernah dibuat pada browser disimpan menggunakan `localStorage`.

Contoh:

```json
[
  "ahmadrizal+x82ka@gmail.com",
  "a.hmad.rizal@gmail.com",
  "ah.madrizal@gmail.com"
]
```

Homepage dapat menampilkan bagian:

```text
Previously Generated

ahmadrizal+x82ka@gmail.com
ah.mad.rizal@gmail.com
ah.madrizal@gmail.com
```

Klik alamat akan membuka mailbox terkait.

Data riwayat browser tidak digunakan sebagai mekanisme keamanan.

---

## 9. Aturan Penyimpanan Pesan

Setiap mailbox memiliki dua aturan utama.

### 9.1 Maksimal 20 Pesan

Mailbox hanya menyimpan **20 pesan terbaru**.

Jika email ke-21 masuk:

```text
21 pesan
   ↓
urutkan berdasarkan received_at DESC
   ↓
simpan 20 terbaru
   ↓
hapus pesan paling lama
```

Dengan demikian database tidak tumbuh tanpa batas pada mailbox yang menerima banyak email.

### 9.2 Retensi 7 Hari

Pesan hanya disimpan maksimal selama 7 hari.

Contoh:

```text
received_at < NOW() - INTERVAL '7 days'
```

Pesan tersebut dihapus oleh cleanup job.

Mailbox sendiri **tidak memiliki expiry** dan tetap dapat dibuka selama record mailbox masih tersedia.

---

## 10. Arsitektur MVP

```text
┌──────────────────────────┐
│     React / Vite UI      │
│                          │
│ - Generate alias         │
│ - Dot / Plus toggle      │
│ - Mailbox viewer         │
│ - Browser history        │
└─────────────┬────────────┘
              │ REST API
              ▼
┌──────────────────────────┐
│ Node.js + Express        │
│ Render Web Service       │
│                          │
│ - REST API               │
│ - Alias generator        │
│ - Gmail polling loop     │
│ - Message parser         │
│ - Cleanup process        │
└──────────┬─────────┬─────┘
           │         │
           ▼         ▼
      Supabase     Gmail API
      Postgres
```

Untuk MVP, API dan Gmail polling dapat dijalankan pada satu Node.js process.

Jika traffic meningkat, Gmail poller dapat dipindahkan ke Background Worker tanpa perubahan besar terhadap database maupun API.

---

## 11. Tech Stack

| Komponen | Teknologi |
|---|---|
| Frontend | React + Vite |
| Styling | Tailwind CSS atau CSS biasa |
| Backend | Node.js + Express |
| Database | Supabase PostgreSQL |
| Gmail | Gmail API v1 |
| OAuth | Google OAuth 2.0 |
| Deployment | Render Web Service |
| Secret Storage | Render Environment Variables |

---

## 12. Gmail Source Account

MVP hanya menggunakan **satu akun Gmail sumber**.

Contoh:

```text
SOURCE_EMAIL=ahmadrizal@gmail.com
```

Semua alias dibuat dari akun tersebut.

Environment variables:

```env
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SOURCE_EMAIL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Refresh token Gmail tidak disimpan pada database untuk MVP.

---

## 13. Alias Generator

### 13.1 Dot Trick

Misalnya akun sumber:

```text
ahmadrizal@gmail.com
```

Generator dapat menghasilkan:

```text
a.hmadrizal@gmail.com
ah.mad.rizal@gmail.com
ahmadri.zal@gmail.com
```

Titik hanya boleh ditempatkan di antara karakter pada local-part Gmail.

Generator harus menghindari:

```text
.ahmadrizal@gmail.com
ahmadrizal.@gmail.com
ahmad..rizal@gmail.com
```

Sebelum disimpan, backend harus memastikan alias belum terdaftar.

---

## 14. Plus Trick

Plus trick menambahkan random tag pada alamat Gmail sumber.

Contoh:

```text
ahmadrizal+x8k29a@gmail.com
ahmadrizal+9mx2qp@gmail.com
ahmadrizal+temp73@gmail.com
```

Format tag MVP:

```text
[a-z0-9]{6}
```

Contoh fungsi:

```js
function randomTag(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}
```

Plus trick dapat dijadikan pilihan default karena memiliki ruang alias yang lebih besar dibanding kombinasi dot.

---

## 15. Data Model

### 15.1 Mailboxes

```sql
create table mailboxes (
    id uuid primary key default gen_random_uuid(),

    address text unique not null,

    trick_type text not null
        check (trick_type in ('dot', 'plus')),

    created_at timestamptz default now()
);
```

Index:

```sql
create index idx_mailboxes_address
on mailboxes(address);
```

---

### 15.2 Messages

```sql
create table messages (
    id uuid primary key default gen_random_uuid(),

    mailbox_id uuid not null
        references mailboxes(id)
        on delete cascade,

    gmail_message_id text unique not null,

    sender text,
    recipient text,
    subject text,
    snippet text,

    body_html text,
    body_text text,

    received_at timestamptz,
    created_at timestamptz default now()
);
```

Indexes:

```sql
create index idx_messages_mailbox
on messages(mailbox_id);

create index idx_messages_mailbox_received
on messages(mailbox_id, received_at desc);

create index idx_messages_received
on messages(received_at);
```

---

### 15.3 Application State

Digunakan untuk menyimpan checkpoint Gmail History API.

```sql
create table app_state (
    key text primary key,
    value text
);
```

Contoh:

```text
gmail_history_id = 18372918
```

---

## 16. Database Function: Maksimal 20 Pesan

Supabase/PostgreSQL dapat menangani cleanup per mailbox melalui function.

```sql
create or replace function trim_mailbox_messages(
    target_mailbox uuid
)
returns void
language sql
as $$
    delete from messages
    where mailbox_id = target_mailbox
      and id not in (
          select id
          from messages
          where mailbox_id = target_mailbox
          order by received_at desc, created_at desc
          limit 20
      );
$$;
```

Setelah worker memasukkan pesan:

```js
await supabase.rpc('trim_mailbox_messages', {
  target_mailbox: mailboxId
});
```

---

## 17. Cleanup Pesan 7 Hari

Cleanup dijalankan secara berkala, misalnya setiap satu jam.

SQL:

```sql
delete from messages
where received_at < now() - interval '7 days';
```

MVP dapat menjalankannya langsung melalui Node.js:

```js
setInterval(deleteExpiredMessages, 60 * 60 * 1000);
```

Render Cron Job atau `pg_cron` dapat digunakan pada versi berikutnya jika diperlukan.

---

## 18. Gmail Polling Flow

Backend menyimpan `history_id` terakhir dari Gmail.

Polling dijalankan kira-kira setiap 10 detik.

```text
start
  ↓
load history_id
  ↓
Gmail history.list()
  ↓
ada messagesAdded?
  ↓
ambil Gmail message ID
  ↓
messages.get(format=full)
  ↓
extract recipient
  ↓
cari mailbox aktif
  ↓
match?
  ├── tidak → ignore
  └── ya
       ↓
    parse email
       ↓
    INSERT messages
       ↓
    trim menjadi 20 pesan
       ↓
update history_id
```

Polling menggunakan incremental Gmail History API agar backend tidak perlu melakukan full inbox scan berulang kali.

---

## 19. Parsing Recipient

Worker perlu membaca header seperti:

```text
To
Delivered-To
Envelope-To
```

Target utama adalah menemukan alamat alias yang digunakan ketika email dikirim.

Contoh:

```text
Delivered-To: ahmadrizal+x82ka@gmail.com
```

Worker kemudian mencari:

```sql
select id
from mailboxes
where lower(address) = lower($1)
limit 1;
```

Jika ditemukan, email disimpan pada mailbox terkait.

---

## 20. Email Body

Saat email baru ditemukan, worker langsung memanggil:

```text
messages.get(format=full)
```

Kemudian menyimpan:

```text
sender
recipient
subject
snippet
body_text
body_html
received_at
```

Dengan pendekatan tersebut, membuka detail email tidak membutuhkan request baru ke Gmail API.

---

## 21. API Endpoints

### POST `/api/mailboxes`

Membuat mailbox baru.

Request:

```json
{
  "type": "plus"
}
```

Response:

```json
{
  "address": "ahmadrizal+x82ka@gmail.com",
  "type": "plus",
  "url": "/mailbox/#ahmadrizal+x82ka@gmail.com"
}
```

---

### GET `/api/mailboxes/:address/messages`

Mengambil maksimal 20 pesan terbaru.

Response:

```json
{
  "mailbox": "ahmadrizal+x82ka@gmail.com",
  "messages": []
}
```

Query database:

```sql
select *
from messages
where mailbox_id = $1
order by received_at desc
limit 20;
```

---

### GET `/api/messages/:id`

Mengambil detail satu pesan.

Response:

```json
{
  "id": "...",
  "sender": "noreply@example.com",
  "recipient": "ahmadrizal+x82ka@gmail.com",
  "subject": "Verify your email",
  "body_html": "...",
  "body_text": "...",
  "received_at": "2026-08-19T10:30:00+07:00"
}
```

---

### DELETE `/api/messages/:id`

Opsional untuk menghapus satu pesan secara manual.

Tidak memerlukan authentication pada MVP.

---

### DELETE `/api/mailboxes/:address`

Opsional untuk menghapus mailbox beserta seluruh pesan.

Karena mailbox bersifat publik, endpoint ini sebaiknya tidak ditampilkan pada UI MVP apabila tidak diperlukan.

---

## 22. Frontend

### 22.1 Homepage

Contoh tampilan:

```text
Temporary Gmail

[ Dot Trick ] [ Plus Trick ]

┌──────────────────────────────────────┐
│ ahmadrizal+x82ka@gmail.com    Copy   │
└──────────────────────────────────────┘

[ Generate New ]

Previously Generated
──────────────────────────────────────
ahmadrizal+x82ka@gmail.com
ah.mad.rizal@gmail.com
```

---

### 22.2 Mailbox Page

Contoh:

```text
ahmadrizal+x82ka@gmail.com
[ Copy ]

Inbox — latest 20 messages
────────────────────────────────────────
GitHub
Verify your email                     10:31
────────────────────────────────────────
Discord
Your verification code               10:29
────────────────────────────────────────
Example
Welcome                               10:21
```

Mailbox page dapat melakukan polling API setiap 5–10 detik.

```js
setInterval(loadMessages, 5000);
```

Supabase Realtime belum diperlukan untuk MVP.

---

## 23. Backend Structure

Struktur sederhana:

```text
server/
│
├── src/
│   ├── index.js
│   ├── routes/
│   │   ├── mailboxes.js
│   │   └── messages.js
│   │
│   ├── services/
│   │   ├── gmail.js
│   │   ├── poller.js
│   │   ├── alias.js
│   │   ├── parser.js
│   │   └── cleanup.js
│   │
│   └── lib/
│       └── supabase.js
│
├── package.json
└── .env
```

Frontend:

```text
client/
│
├── src/
│   ├── pages/
│   │   ├── Home.jsx
│   │   └── Mailbox.jsx
│   │
│   ├── components/
│   │   ├── AliasToggle.jsx
│   │   ├── MailboxCard.jsx
│   │   └── MessageItem.jsx
│   │
│   └── api.js
│
└── package.json
```

---

## 24. Runtime Flow

Node process dapat menjalankan tiga fungsi utama:

```js
startExpressServer();
startGmailPoller();
startCleanupJob();
```

Polling:

```js
setInterval(pollGmail, 10_000);
```

Cleanup:

```js
setInterval(deleteExpiredMessages, 60 * 60 * 1000);
```

---

## 25. Rate Limiting

Walaupun mailbox publik, endpoint generate perlu rate limiting sederhana.

Contoh:

```text
POST /api/mailboxes
maksimum 5 request / menit / IP
```

Endpoint mailbox dapat diberi limit lebih longgar:

```text
GET mailbox
maksimum 120 request / menit / IP
```

Tujuan utama bukan keamanan mailbox, tetapi mencegah spam request dan pemborosan resource.

---

## 26. Security Considerations

### Gmail Credential

Credential Gmail hanya tersedia pada backend.

Tidak boleh dikirim ke browser:

```text
GMAIL_REFRESH_TOKEN
GMAIL_CLIENT_SECRET
SUPABASE_SERVICE_ROLE_KEY
```

### Public Mailbox

Mailbox sengaja tidak memiliki authentication.

Implikasi:

- alamat mailbox berfungsi seperti identifier publik;
- siapa pun yang mengetahui alamat dapat melihat pesan;
- OTP dan verification link pada mailbox dapat dilihat pihak lain;
- produk harus menampilkan peringatan bahwa mailbox bersifat publik.

Contoh UI warning:

```text
Public inbox — anyone with this address can read its messages.
```

### HTML Email

`body_html` tidak boleh dirender langsung menggunakan HTML mentah tanpa sanitasi.

Gunakan HTML sanitizer sebelum memasukkan content ke DOM untuk menghindari XSS.

---

## 27. Deployment Render

Untuk MVP:

| Service | Render |
|---|---|
| React | Static Site atau serve dari Express |
| Node API | Web Service |
| Gmail Poller | Sama dengan Web Service |
| Cleanup | Sama dengan Web Service |
| Database | Supabase |

Arsitektur satu service dipilih untuk meminimalkan kompleksitas deployment.

Apabila aplikasi mulai memiliki traffic tinggi:

```text
Web Service
    ↓
API only

Background Worker
    ↓
Gmail polling
```

pemisahan tersebut dapat dilakukan kemudian.

---

## 28. Environment Variables

```env
PORT=3000

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SOURCE_EMAIL=

POLL_INTERVAL_MS=10000
MESSAGE_RETENTION_DAYS=7
MAX_MESSAGES_PER_MAILBOX=20
```

---

## 29. Error Handling

Worker minimal harus menangani:

### Gmail API Error

```text
401 → refresh OAuth token
403 → quota / permission issue
404 historyId → lakukan resync checkpoint
429 → backoff sementara
5xx → retry exponential backoff
```

### Database Error

Jika insert gagal:

1. Jangan langsung kehilangan `history_id` terkait pesan tersebut.
2. Log error.
3. Retry proses pada polling berikutnya.

### Duplicate Gmail Message

Kolom berikut bersifat unique:

```text
gmail_message_id
```

Duplicate insert dapat diabaikan.

---

## 30. Logging

Minimal log:

```text
[INFO] Gmail polling started
[INFO] New Gmail message detected
[INFO] Message matched mailbox: xxx@gmail.com
[INFO] Message stored
[INFO] Mailbox trimmed to 20 messages
[INFO] Expired messages deleted
[ERROR] Gmail API request failed
```

Tidak perlu menyimpan email body pada log.

---

## 31. Metrik MVP

Metrik yang perlu dipantau:

- jumlah mailbox yang dibuat;
- jumlah pesan yang diterima;
- waktu Gmail received → message available di UI;
- jumlah Gmail API error;
- jumlah polling gagal;
- jumlah pesan yang dihapus karena limit 20;
- jumlah pesan yang dihapus karena retensi 7 hari.

Target utama:

```text
Email received → visible in UI < 15 seconds
```

---

## 32. Milestone

### M1 — Gmail Integration

- Setup Google OAuth.
- Generate refresh token.
- Connect Gmail API.
- Implement `history.list`.
- Implement `messages.get`.
- Parse recipient alias.

### M2 — Alias + Database

- Setup Supabase schema.
- Dot alias generator.
- Plus alias generator.
- Mailbox creation.
- Message matching.
- Limit 20 pesan.
- Cleanup 7 hari.

### M3 — Frontend

- Homepage.
- Dot / Plus toggle.
- Generate button.
- Copy button.
- Mailbox URL.
- Inbox list.
- Email detail.
- Browser mailbox history.

### M4 — Deployment

- Deploy Node service ke Render.
- Deploy React frontend.
- Configure environment variables.
- Add rate limiting.
- Add HTML sanitization.
- Test polling end-to-end.

---

## 33. Acceptance Criteria MVP

MVP dianggap selesai jika seluruh kondisi berikut terpenuhi:

- Pengguna dapat memilih Dot atau Plus Trick.
- Generate menghasilkan alamat Gmail alias unik.
- Alamat tersimpan pada database.
- URL mailbox dapat dibuka tanpa login.
- Mailbox dapat diakses oleh siapa pun yang mengetahui alamatnya.
- Email yang dikirim ke alias muncul pada mailbox.
- Email dapat dibuka dan body dapat dibaca.
- Inbox hanya menampilkan maksimal 20 pesan.
- Pesan ke-21 menyebabkan pesan tertua dihapus.
- Pesan berumur lebih dari 7 hari otomatis dihapus.
- Mailbox lama dapat dibuka kembali menggunakan URL.
- Browser dapat menampilkan daftar mailbox yang sebelumnya pernah dibuat.
- Gmail credentials tidak terekspos ke frontend.

---

## 34. Scope Final MVP

Versi pertama secara sengaja dibatasi menjadi:

```text
1 Gmail source account
2 alias modes: Dot / Plus
Public mailbox
No login
No mailbox token
Max 20 messages per mailbox
7-day message retention
Polling Gmail every ~10 seconds
Frontend polling every ~5 seconds
React + Express + Supabase + Gmail API
Single Render Web Service
```

Arsitektur tersebut dipilih agar implementasi dapat dilakukan cepat tanpa kehilangan jalur pengembangan menuju multi-account source, dedicated worker, realtime updates, atau private mailbox pada versi berikutnya.
