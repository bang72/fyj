# MIVO V2.1

**Meet the vibe, not the profile.**

MIVO V2 adalah web/PWA anonymous 1-on-1 chat untuk pengguna 18+. Fokusnya adalah percakapan terlebih dahulu, identitas dibuka hanya dengan persetujuan dua pihak, dan connection dibuat hanya bila keduanya setuju.

> Talk first. Feel the vibe. Reveal by choice. Connect by consent.

## Apa yang berubah di V2

V2 menyederhanakan fondasi project agar deployment lebih stabil dan mudah di-debug:

- Vercel-first: satu runtime Next.js, tidak lagi hybrid Vinext/Vite/Cloudflare.
- Satu build path: `npm run build` = `next build`.
- PostgreSQL/Neon sebagai database production.
- Versioned database migrations melalui `db/migrations`.
- `/api/health` untuk memeriksa database, auth secrets, realtime, billing, dan storage.
- Error boundary, loading state, 404, dan recovery UI.
- MIVO V2 status card di Profile.
- Second Chance hanya muncul setelah alur **Next**, sesuai aturan backend.
- Private post-chat feedback: **Great vibe / It was okay / Don’t rematch soon**.
- Pilihan `Don’t rematch soon` mencegah pasangan yang sama diprioritaskan kembali selama 30 hari.
- Tidak ada dummy user, fake match, seeded online counter, atau fake chat.

## Fitur inti

### Account & privacy

- Register 18+ menggunakan username + password.
- Tidak wajib email, nomor HP, Google, atau nama asli.
- Recovery codes.
- Multiple sessions + revoke session.
- Password change.
- Export data.
- Delete account.

### Matchmaking

- Random gender gratis.
- Vibe-first matching.
- Gender preference dengan entitlement PLUS/MAX.
- Presence nyata dan queue server-side.
- Reciprocal gender compatibility.
- Block exclusion.
- Recent-match exclusion.
- Active-room locking.
- Queue expiry/cleanup.
- Match ranking berdasarkan vibe overlap lalu waktu antre.
- Private negative feedback ikut mengurangi rematch cepat.

### Chat

- 1-on-1 room nyata di database.
- Message ordering per room.
- Optimistic send + retry.
- Reply message.
- Typing status.
- Delivered/read status.
- Pagination.
- Ably realtime opsional.
- Adaptive persistent polling fallback jika Ably tidak diaktifkan.

### Consent & identity

- Vibe Check mutual.
- Identity reveal Layer 1–4.
- Age visibility control.
- General location hanya bila user memberi consent.
- Photo/contact tetap tersembunyi sampai layer terkait dibuka bersama.
- Retention choice.
- Mutual Connection.
- Consent-based Second Chance.

### Safety

- Report room/message.
- Evidence snapshot untuk moderation.
- Block instan.
- Rate limiting server-side.
- Duplicate-message detection.
- Suspicious URL warning.
- Trust events/bands.
- Moderator/Admin console.
- Security headers dan CSP.

### Membership

- **FREE**: random gender.
- **PLUS — Rp20.000/bulan**: hingga 20 successful gender-filtered matches per entitlement day.
- **MAX — Rp30.000/bulan**: gender filter tanpa kuota harian normal, tetap tunduk pada fair-use/anti-abuse.
- Stripe hanya aktif bila konfigurasi lengkap; tidak ada fake purchase fallback.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- PostgreSQL / Neon serverless
- Ably opsional untuk realtime
- Stripe opsional untuk subscriptions
- S3-compatible private object storage opsional
- Vercel

## Menjalankan lokal

### 1. Install

```bash
npm ci
```

### 2. Environment

```bash
cp .env.example .env.local
```

Minimal isi:

```env
DATABASE_URL=postgresql://...
AUTH_SECRET=minimum-32-character-random-secret
SECURITY_PEPPER=another-minimum-32-character-random-secret
PASSWORD_PEPPER=another-minimum-32-character-random-secret
APP_ORIGIN=http://localhost:3000
APP_TIMEZONE=Asia/Jakarta
```

Gunakan tiga secret yang berbeda.

### 3. Database migration

```bash
npm run db:migrate
```

Migration runner membuat ledger `mivo_schema_migrations`. Jika database V1 sudah memiliki tabel MIVO sebelum ledger dibuat, migration `0001_initial.sql` akan dibaseline lalu migration V2 berikutnya diterapkan.

### 4. Run

```bash
npm run dev
```

Buka `http://localhost:3000`.

## Quality checks

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

Atau semuanya:

```bash
npm run verify
```

## Deploy ke Vercel

### Project settings

- Framework Preset: **Next.js**
- Root Directory: `./`
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: biarkan default
- Node.js: 22.x atau 24.x yang kompatibel dengan `engines`

`vercel.json` sudah berisi:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "npm run build"
}
```

### Environment Variables di Vercel

Wajib:

- `DATABASE_URL`
- `AUTH_SECRET`
- `SECURITY_PEPPER`
- `PASSWORD_PEPPER`
- `APP_ORIGIN`
- `APP_TIMEZONE`

Opsional:

- `ABLY_API_KEY`
- Stripe variables
- S3 variables
- `ADMIN_BOOTSTRAP_TOKEN`

Set `APP_ORIGIN` ke production domain, misalnya `https://mivo.example.com` atau domain `.vercel.app` final.

### Setelah deploy

Buka:

```text
https://DOMAIN-KAMU/api/health
```

Deployment minimum siap digunakan ketika hasilnya:

```json
{
  "status": "ready",
  "checks": {
    "database": { "configured": true, "reachable": true },
    "auth": true
  }
}
```

Realtime, billing, dan storage boleh `false` jika fitur opsional tersebut belum dipasang.

## Database migrations

Urutan migration berada di:

```text
db/migrations/
  0001_initial.sql
  0002_v2_conversation_feedback.sql
```

Jangan mengedit migration yang sudah pernah diterapkan di production. Buat migration baru dengan nomor berikutnya.

## Realtime

Jika `ABLY_API_KEY` tersedia, client menggunakan channel realtime dengan capability terbatas. Tanpa Ably, MIVO tetap menggunakan data persisten dan adaptive polling. Fallback ini tidak membuat pesan/match palsu.

## Private media

Photo upload hanya aktif jika S3-compatible storage lengkap. Object tetap private dan dibaca melalui route MIVO setelah authorization.

## Stripe

Billing hanya dianggap aktif bila secret, webhook secret, serta Price ID PLUS dan MAX tersedia. Backend memverifikasi bahwa price sesuai plan yang diharapkan sebelum membuat Checkout Session.

Webhook endpoint:

```text
/api/webhooks/stripe
```

## Admin bootstrap

1. Register account normal.
2. Set `ADMIN_BOOTSTRAP_TOKEN` di environment.
3. Gunakan route bootstrap admin sesuai endpoint project.
4. Setelah admin pertama berhasil dibuat, rotasi/hapus token bootstrap.

## Struktur penting

```text
app/
  api/                  route handlers
  moderation/           staff console
  mivo-app.tsx          main client experience
components/ui/          UI primitives
lib/
  database.ts           Neon + private S3 adapter
  matchmaking.ts        queue and matching engine
  rooms.ts              chat, consent, safety, connection logic
  server-foundation.ts  sessions, rate limits, maintenance
  realtime.ts           Ably + realtime helpers
  billing.ts            Stripe provider
db/migrations/          ordered PostgreSQL migrations
scripts/
  migrate-postgres.mjs  versioned migration runner
tests/                  deterministic project/core tests
public/                  logo, PWA icons, service worker
vercel.json              Vercel build contract
```

## Production checklist

Sebelum launch publik:

- [ ] `npm run verify` lulus.
- [ ] Migration production sudah diterapkan.
- [ ] `/api/health` = `ready`.
- [ ] Tiga security secret berbeda dan >= 32 karakter.
- [ ] `APP_ORIGIN` menunjuk domain production.
- [ ] HTTPS aktif.
- [ ] Register → Login → Search → Match → Chat diuji di dua device/account berbeda.
- [ ] Report dan Block diuji.
- [ ] Identity reveal diuji dari kedua akun.
- [ ] Second Chance diuji setelah **Next**.
- [ ] Private feedback diuji.
- [ ] Backup database aktif.
- [ ] Stripe webhook diuji jika billing diaktifkan.
- [ ] Storage private diuji jika photo upload diaktifkan.
- [ ] Moderator/Admin access diuji.

## Prinsip produk

MIVO tidak boleh menampilkan activity palsu untuk membuat aplikasi terlihat ramai. Production dapat mulai kosong. User, online presence, queue, match, chat, connection, notification, entitlement, dan moderation state harus berasal dari data nyata.

## Admin bawaan & Trust & Safety Console (V2.1)

MIVO V2.1 dapat membuat **satu akun ADMIN awal** tanpa menyimpan password di source code. Tambahkan environment berikut sebelum menjalankan migration:

```env
MIVO_ADMIN_USERNAME=mivo.owner
MIVO_ADMIN_PASSWORD=gunakan-password-owner-yang-panjang-dan-unik
MIVO_ADMIN_ALIAS=MIVO Owner
```

Lalu jalankan:

```bash
npm run db:migrate
```

`db:migrate` menjalankan semua migration dan kemudian bootstrap admin secara **idempotent**. Jika admin aktif sudah ada, script tidak membuat admin kedua. Bootstrap juga bisa dijalankan manual:

```bash
npm run admin:bootstrap
```

> Jangan pernah commit `MIVO_ADMIN_PASSWORD`, `PASSWORD_PEPPER`, atau secret production ke GitHub. Simpan hanya di `.env.local` atau Vercel Environment Variables.

Setelah login menggunakan akun owner, buka **Profile → Moderation console** atau langsung `/moderation`.

### Kemampuan ADMIN

- Overview jumlah user, report terbuka/urgent, suspend, ban, dan moderation actions 24 jam terakhir.
- Report queue: claim/unassign case, review, priority 0–20, internal note, resolve, dismiss, dan remove message.
- User search berdasarkan username, alias, atau public ID.
- Warning dengan notifikasi in-app dan perubahan trust score.
- Timed suspension: 1 jam, 6 jam, 1/3/7/30/90 hari. Suspension otomatis berakhir saat user login setelah waktu habis.
- Permanent ban dan restore/unban.
- Force logout seluruh sesi target.
- Internal moderation notes dan warning counter.
- Audit log lengkap: actor, target, action, reason, expiry, report source, dan waktu.
- Staff management: USER / MODERATOR / ADMIN dengan proteksi agar admin terakhir tidak bisa didemote.
- Suspend/ban otomatis membatalkan matchmaking, menutup presence, mencabut session, dan mengakhiri active room target.

### Kemampuan MODERATOR

Moderator dapat review report, menambahkan note/priority, warning, menghapus message yang dilaporkan, dan memberi suspension hingga 7 hari. Permanent ban, restore, force logout, audit penuh, dan pengelolaan staff hanya tersedia untuk ADMIN.
