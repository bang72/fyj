# MIVO V2 Architecture

MIVO V2 memakai satu deployment target utama: **Vercel + Next.js + PostgreSQL/Neon**.

## Runtime

- Next.js App Router menjalankan UI dan Route Handlers.
- Node.js runtime digunakan untuk server routes.
- Database client memakai Neon serverless HTTP agar cocok dengan serverless execution.
- Tidak ada Worker/D1 runtime abstraction di V2.

## Persistence

Database adalah source of truth untuk:

- user/account/security state
- presence and matchmaking queue
- rooms and messages
- identity consent state
- blocks/reports/moderation
- subscriptions/entitlements
- connections/notifications
- private post-chat feedback

Realtime tidak pernah menjadi source of truth. Ably hanya mempercepat delivery event; client dapat kembali ke polling tanpa mengubah data model.

## Matchmaking invariants

1. Hanya user `active` dengan presence fresh yang eligible.
2. Tidak ada match dengan diri sendiri.
3. Reciprocal block selalu mengecualikan pasangan.
4. User dengan active room tidak dapat mendapat room kedua.
5. Gender preference harus kompatibel dua arah.
6. Paid gender preference diverifikasi server-side.
7. Successful filtered match baru memakai entitlement quota.
8. Recent match pair dikecualikan dalam window normal.
9. Feedback `skip` mengecualikan quick rematch selama 30 hari.
10. Vibe overlap lebih tinggi diprioritaskan sebelum queue age.

## Privacy invariants

1. Tidak perlu email/phone/real name.
2. Password tidak disimpan plaintext.
3. Session token disimpan sebagai hash.
4. Recovery code disimpan sebagai keyed hash.
5. Identity details hanya dikirim setelah mutual layer unlock.
6. Block/report choice tidak dibocorkan ke target sebagai identitas pelapor.
7. Private storage object tidak memiliki public URL permanen dari aplikasi.

## Vercel health

`GET /api/health` memeriksa konfigurasi minimum dan koneksi database. Endpoint tidak mengembalikan nilai secret.

Minimum ready:

- database configured + reachable
- AUTH_SECRET valid
- SECURITY_PEPPER valid
- PASSWORD_PEPPER valid

Ably, Stripe, dan S3 bersifat opsional.

## Database migrations

`npm run db:migrate` menjalankan migration berurutan dari `db/migrations` dan merekam hasil di `mivo_schema_migrations`.

Migration yang sudah diterapkan tidak boleh diubah. Perubahan schema selalu memakai file migration baru.
