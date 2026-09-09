
import { getDatabase } from "@/lib/database";
import {
  VIBES,
  hmacSha256,
  publicId,
  randomBytes,
  randomId,
  safeEqual,
} from "@/lib/mivo-core";

export const SESSION_COOKIE = "mivo_session";

export type Viewer = {
  id: string;
  public_id: string;
  username: string;
  status: "active" | "suspended" | "banned" | "deleted";
  role: "USER" | "MODERATOR" | "ADMIN";
  trust_score: number;
  trust_band: "new" | "established" | "trusted";
  created_at: string;
  alias: string;
  avatar_hue: number;
  bio: string;
  birth_date: string;
  gender: "woman" | "man" | "nonbinary" | "private";
  region: string | null;
  city: string | null;
  photo_key: string | null;
  contact_type: string | null;
  contact_value: string | null;
  age_visibility: "range" | "exact" | "hidden";
  location_consent: number;
  desired_gender: "random" | "woman" | "man";
  read_receipts: number;
  sensitive_media: "blur" | "block";
  reconnect_policy: "allow" | "connections" | "nobody";
  appearance: "dark" | "light" | "system";
  push_enabled: number;
  session_token_hash: string;
  session_device_label: string;
  session_created_at: string;
  session_last_seen_at: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function runtimeValue(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function requiredSecret(name: "AUTH_SECRET" | "SECURITY_PEPPER" | "PASSWORD_PEPPER") {
  const value = runtimeValue(name);
  if (!value || value.length < 32) throw new Error(`MIVO_CONFIG_${name}`);
  return value;
}

function parseCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Browser";
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh/i.test(userAgent)) return "Mac";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Browser";
}

export async function sessionHash(token: string) {
  return hmacSha256(requiredSecret("AUTH_SECRET"), token);
}

export async function prepareSession(userId: string, request: Request) {
  const token = bytesToHex(randomBytes(32));
  const tokenHash = await sessionHash(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const statement = getDatabase().prepare(
    "INSERT INTO sessions (token_hash, user_id, device_label, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(tokenHash, userId, deviceLabel(request.headers.get("user-agent")), now.toISOString(), now.toISOString(), expiresAt);
  return {
    token,
    tokenHash,
    statement,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Priority=High; Max-Age=${30 * 86_400}`,
  };
}

export function expiredSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Priority=High; Max-Age=0`;
}

export async function getViewer(request: Request): Promise<Viewer | null> {
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sessionHash(token);
  const now = new Date().toISOString();
  const viewer = await getDatabase().prepare(
    `SELECT u.id, u.public_id, u.username, u.status, u.role, u.trust_score, u.trust_band, u.created_at,
      p.alias, p.avatar_hue, p.bio, i.birth_date, i.gender, i.region, i.city, i.photo_key, i.contact_type, i.contact_value,
      i.age_visibility, i.location_consent, pref.desired_gender, pref.read_receipts,
      pref.sensitive_media, pref.reconnect_policy, pref.appearance, pref.push_enabled,
      s.token_hash AS session_token_hash, s.device_label AS session_device_label,
      s.created_at AS session_created_at, s.last_seen_at AS session_last_seen_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN profiles p ON p.user_id = u.id
     JOIN identities i ON i.user_id = u.id
     JOIN preferences pref ON pref.user_id = u.id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
     LIMIT 1`,
  ).bind(tokenHash, now).first<Viewer>();
  if (!viewer || viewer.status === "deleted" || viewer.status === "banned") return null;
  if (Date.now() - new Date(viewer.session_last_seen_at).getTime() > 300_000) {
    await getDatabase().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(now, tokenHash).run();
  }
  return viewer;
}

export async function requireViewer(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) throw new Error("AUTH_REQUIRED");
  if (viewer.status === "suspended") throw new Error("ACCOUNT_SUSPENDED");
  return viewer;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("CSRF_REJECTED");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new Error("CSRF_REJECTED");
}

export async function revokeSession(request: Request) {
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return;
  await getDatabase().prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), await sessionHash(token)).run();
}

export async function requestFingerprint(request: Request, action: string, userId = "anonymous") {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const agent = request.headers.get("user-agent") ?? "unknown";
  return hmacSha256(requiredSecret("SECURITY_PEPPER"), `${action}:${userId}:${address}:${agent.slice(0, 160)}`);
}

export async function consumeRateLimit(
  request: Request,
  action: string,
  limit: number,
  windowSeconds: number,
  userId = "anonymous",
) {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const keyHash = await requestFingerprint(request, action, userId);
  const database = getDatabase();
  await database.prepare(
    `INSERT INTO rate_limits (key_hash, action, window_start, count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(key_hash, action, window_start)
     DO UPDATE SET count = rate_limits.count + 1, updated_at = excluded.updated_at`,
  ).bind(keyHash, action, windowStart, new Date().toISOString()).run();
  const row = await database.prepare(
    "SELECT count FROM rate_limits WHERE key_hash = ? AND action = ? AND window_start = ?",
  ).bind(keyHash, action, windowStart).first<{ count: number }>();
  if ((row?.count ?? 1) > limit) {
    if (userId !== "anonymous") {
      await database.prepare(
        "INSERT INTO security_events (id, user_id, fingerprint_hash, event_type, severity, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(randomId("sec"), userId, keyHash, "rate_limit_exceeded", 1, JSON.stringify({ action }), new Date().toISOString()).run();
    }
    return false;
  }
  return true;
}

let referenceDataPromise: Promise<void> | null = null;

export async function ensureReferenceData() {
  if (referenceDataPromise) return referenceDataPromise;
  referenceDataPromise = (async () => {
    const database = getDatabase();
    await database.batch(VIBES.map((vibe, position) => database.prepare(
      `INSERT INTO vibes (id, label, position, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, position = excluded.position, active = 1`,
    ).bind(vibe.id, vibe.label, position)));
  })().catch((error) => {
    referenceDataPromise = null;
    throw error;
  });
  return referenceDataPromise;
}

let maintenanceAt = 0;

export async function runMaintenance() {
  if (Date.now() - maintenanceAt < 60_000) return;
  maintenanceAt = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();
  const stalePresence = new Date(now.getTime() - 90_000).toISOString();
  const staleClaims = new Date(now.getTime() - 20_000).toISOString();
  const evidenceExpiry = nowIso;
  const database = getDatabase();
  await database.batch([
    database.prepare("UPDATE presence SET status = 'offline', updated_at = ? WHERE last_heartbeat_at < ? AND status != 'offline'").bind(nowIso, stalePresence),
    database.prepare("UPDATE matchmaking_queue SET status = 'expired', updated_at = ? WHERE status IN ('queued', 'claiming') AND user_id IN (SELECT user_id FROM presence WHERE last_heartbeat_at < ?)").bind(nowIso, stalePresence),
    database.prepare("UPDATE matchmaking_queue SET status = 'expired', updated_at = ? WHERE expires_at < ? AND status IN ('queued', 'claiming')").bind(nowIso, nowIso),
    database.prepare("UPDATE matchmaking_queue SET status = 'queued', claim_token = NULL, claimed_at = NULL, updated_at = ? WHERE status = 'claiming' AND claimed_at < ?").bind(nowIso, staleClaims),
    database.prepare("DELETE FROM active_room_locks WHERE room_id NOT IN (SELECT id FROM rooms WHERE status = 'active')"),
    database.prepare("UPDATE sessions SET revoked_at = ? WHERE expires_at < ? AND revoked_at IS NULL").bind(nowIso, nowIso),
    database.prepare("UPDATE users SET status = 'active', suspended_until = NULL, moderation_reason = NULL, updated_at = ? WHERE status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until <= ?").bind(nowIso, nowIso),
    database.prepare("DELETE FROM report_evidence WHERE expires_at < ?").bind(evidenceExpiry),
    database.prepare("UPDATE messages SET body = '[expired]', body_hash = NULL, deleted_at = ? WHERE room_id IN (SELECT id FROM rooms WHERE retention_until IS NOT NULL AND retention_until < ?) AND deleted_at IS NULL").bind(nowIso, nowIso),
    database.prepare("UPDATE rooms SET status = 'expired', updated_at = ? WHERE retention_until IS NOT NULL AND retention_until < ? AND status = 'ended'").bind(nowIso, nowIso),
    database.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(Math.floor(now.getTime() / 1000) - 172_800),
  ]);
}

export async function createNotification(userId: string, type: string, title: string, body: string, entityPublicId: string | null = null) {
  const id = randomId("ntf");
  const notificationPublicId = publicId("note");
  await getDatabase().prepare(
    "INSERT INTO notifications (id, public_id, user_id, type, title, body, entity_public_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, notificationPublicId, userId, type, title, body, entityPublicId, new Date().toISOString()).run();
  return notificationPublicId;
}

export async function getPlan(userId: string) {
  const now = new Date().toISOString();
  const row = await getDatabase().prepare(
    `SELECT plan, status, current_period_end, cancel_at_period_end
     FROM subscriptions
     WHERE user_id = ? AND status IN ('active', 'trialing')
       AND (current_period_end IS NULL OR current_period_end > ?)
     ORDER BY CASE plan WHEN 'MAX' THEN 3 WHEN 'PLUS' THEN 2 ELSE 1 END DESC, updated_at DESC
     LIMIT 1`,
  ).bind(userId, now).first<{ plan: "PLUS" | "MAX"; status: string; current_period_end: string | null; cancel_at_period_end: number }>();
  return row ? { ...row, plan: row.plan as "PLUS" | "MAX" } : { plan: "FREE" as const, status: "active", current_period_end: null, cancel_at_period_end: 0 };
}

export function isAuthError(error: unknown) {
  return error instanceof Error && error.message === "AUTH_REQUIRED";
}

export function jsonError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known: Record<string, [string, number]> = {
    AUTH_REQUIRED: ["Sesi kamu sudah berakhir. Masuk lagi untuk melanjutkan.", 401],
    ACCOUNT_SUSPENDED: ["Akun sedang ditangguhkan. Coba masuk kembali setelah masa penangguhan berakhir.", 403],
    CSRF_REJECTED: ["Permintaan ditolak demi keamanan. Muat ulang lalu coba lagi.", 403],
    MIVO_DATABASE_UNAVAILABLE: ["Database MIVO belum dikonfigurasi.", 503],
    MIVO_CONFIG_AUTH_SECRET: ["Konfigurasi keamanan sesi belum lengkap.", 503],
    MIVO_CONFIG_SECURITY_PEPPER: ["Konfigurasi perlindungan penyalahgunaan belum lengkap.", 503],
    MIVO_CONFIG_PASSWORD_PEPPER: ["Konfigurasi keamanan password belum lengkap.", 503],
  };
  const [message, status] = known[code] ?? ["MIVO belum dapat memproses permintaan itu. Coba lagi.", 500];
  return Response.json({ error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

export async function verifyWebhookSignature(payload: string, signature: string, secret: string) {
  const expected = await hmacSha256(secret, payload);
  return safeEqual(expected, signature);
}
