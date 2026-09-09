import { z } from "zod";

import { getDatabase } from "@/lib/database";
import {
  createRecoveryCode,
  hashPassword,
  hmacSha256,
  isAdult,
  makeAlias,
  normalizeRecoveryCode,
  normalizeUsername,
  passwordError,
  publicId,
  randomId,
  sanitizeVibes,
  usernameError,
} from "@/lib/mivo-core";
import {
  assertSameOrigin,
  consumeRateLimit,
  ensureReferenceData,
  jsonError,
  prepareSession,
  requiredSecret,
} from "@/lib/server-foundation";

const registrationSchema = z.object({
  username: z.string().max(80),
  password: z.string().max(128),
  confirmPassword: z.string().max(128),
  birthDate: z.string().max(10),
  gender: z.enum(["woman", "man", "nonbinary", "private"]),
  vibes: z.array(z.string()).max(10),
  acceptedTerms: z.literal(true),
  website: z.string().max(0).optional().default(""),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureReferenceData();
    const parsed = registrationSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Periksa kembali data pendaftaranmu." }, { status: 400 });
    const body = parsed.data;
    if (body.website) return Response.json({ error: "Pendaftaran tidak dapat diproses." }, { status: 400 });
    if (!(await consumeRateLimit(request, "register", 6, 86_400))) {
      return Response.json({ error: "Batas pembuatan akun dari jaringan ini sudah tercapai. Coba lagi besok." }, { status: 429 });
    }
    const username = normalizeUsername(body.username);
    const invalidUsername = usernameError(username);
    if (invalidUsername) return Response.json({ error: invalidUsername }, { status: 400 });
    const invalidPassword = passwordError(body.password, username);
    if (invalidPassword) return Response.json({ error: invalidPassword }, { status: 400 });
    if (body.password !== body.confirmPassword) return Response.json({ error: "Konfirmasi password belum sama." }, { status: 400 });
    if (!isAdult(body.birthDate)) return Response.json({ error: "MIVO hanya tersedia untuk pengguna berusia 18 tahun ke atas." }, { status: 403 });
    const selectedVibes = sanitizeVibes(body.vibes);
    if (!selectedVibes.length) return Response.json({ error: "Pilih setidaknya satu vibe." }, { status: 400 });

    const database = getDatabase();
    const exists = await database.prepare("SELECT id FROM users WHERE username = ? LIMIT 1").bind(username).first();
    if (exists) return Response.json({ error: "Username itu sudah digunakan." }, { status: 409 });

    const userId = randomId("usr");
    const userPublicId = publicId("person");
    const passwordData = await hashPassword(body.password, requiredSecret("PASSWORD_PEPPER"));
    const now = new Date().toISOString();
    const hue = crypto.getRandomValues(new Uint16Array(1))[0] % 360;
    const alias = makeAlias(hue);
    const recoveryCodes = Array.from({ length: 8 }, () => createRecoveryCode());
    const recoveryHashes = await Promise.all(recoveryCodes.map((code) => hmacSha256(requiredSecret("AUTH_SECRET"), normalizeRecoveryCode(code))));
    const session = await prepareSession(userId, request);

    await database.batch([
      database.prepare("INSERT INTO users (id, public_id, username, status, role, trust_score, trust_band, created_at, updated_at) VALUES (?, ?, ?, 'active', 'USER', 0, 'new', ?, ?)").bind(userId, userPublicId, username, now, now),
      database.prepare("INSERT INTO credentials (user_id, password_hash, password_salt, password_algorithm, password_iterations, password_changed_at) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, passwordData.hash, passwordData.salt, passwordData.algorithm, passwordData.iterations, now),
      database.prepare("INSERT INTO identities (user_id, birth_date, gender, age_visibility, location_consent, updated_at) VALUES (?, ?, ?, 'range', 0, ?)").bind(userId, body.birthDate, body.gender, now),
      database.prepare("INSERT INTO profiles (user_id, alias, avatar_hue, bio, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)").bind(userId, alias, hue, now, now),
      database.prepare("INSERT INTO preferences (user_id, desired_gender, read_receipts, sensitive_media, reconnect_policy, appearance, push_enabled, updated_at) VALUES (?, 'random', 1, 'block', 'allow', 'dark', 0, ?)").bind(userId, now),
      ...selectedVibes.map((vibe) => database.prepare("INSERT INTO user_vibes (user_id, vibe_id, created_at) VALUES (?, ?, ?)").bind(userId, vibe, now)),
      ...recoveryHashes.map((hash) => database.prepare("INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)").bind(randomId("rcv"), userId, hash, now)),
      session.statement,
      database.prepare("INSERT INTO presence (user_id, status, last_heartbeat_at, updated_at) VALUES (?, 'online', ?, ?)").bind(userId, now, now),
      database.prepare("INSERT INTO verification_status (user_id, status, updated_at) VALUES (?, 'not_started', ?)").bind(userId, now),
      database.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'registration_completed', 'user', ?, '{}', ?)").bind(randomId("aud"), userId, userId, now),
    ]);

    return Response.json(
      { ok: true, recoveryCodes, message: "Akunmu siap. Simpan recovery codes ini di tempat aman." },
      { status: 201, headers: { "set-cookie": session.cookie, "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("register_failed", error);
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("constraint")) return Response.json({ error: "Username itu baru saja digunakan. Pilih yang lain." }, { status: 409 });
    return jsonError(error);
  }
}
