import { z } from "zod";

import { getBucket, getDatabase } from "@/lib/database";
import {
  createRecoveryCode,
  hashPassword,
  hmacSha256,
  normalizeRecoveryCode,
  passwordError,
  randomId,
  safeEqual,
  sanitizeVibes,
  verifyPassword,
} from "@/lib/mivo-core";
import {
  assertSameOrigin,
  expiredSessionCookie,
  jsonError,
  requireViewer,
  requiredSecret,
} from "@/lib/server-foundation";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), bio: z.string().max(180), region: z.string().max(80), city: z.string().max(80), locationConsent: z.boolean(), ageVisibility: z.enum(["range", "exact", "hidden"]), contactType: z.string().max(30), contactValue: z.string().max(120), vibes: z.array(z.string()).max(10) }),
  z.object({ action: z.literal("preferences"), readReceipts: z.boolean(), sensitiveMedia: z.enum(["blur", "block"]), reconnectPolicy: z.enum(["allow", "connections", "nobody"]), appearance: z.enum(["dark", "light", "system"]), pushEnabled: z.boolean() }),
  z.object({ action: z.literal("password"), currentPassword: z.string().max(128), newPassword: z.string().max(128), confirmPassword: z.string().max(128) }),
  z.object({ action: z.literal("recovery_codes"), currentPassword: z.string().max(128) }),
  z.object({ action: z.literal("revoke_session"), sessionId: z.string().regex(/^session_[a-f0-9]{24}$/) }),
  z.object({ action: z.literal("unblock"), userPublicId: z.string().min(8).max(80) }),
  z.object({ action: z.literal("read_notifications") }),
]);

async function passwordRecord(userId: string) {
  return getDatabase().prepare("SELECT password_hash, password_salt, password_algorithm, password_iterations FROM credentials WHERE user_id = ?")
    .bind(userId).first<{ password_hash: string; password_salt: string; password_algorithm: string; password_iterations: number }>();
}

async function sessionPublicId(tokenHash: string) {
  return `session_${(await hmacSha256(requiredSecret("AUTH_SECRET"), `session:${tokenHash}`)).slice(0, 24)}`;
}

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer(request);
    const [sessions, blocks] = await Promise.all([getDatabase().prepare(
      "SELECT token_hash, device_label, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 20",
    ).bind(viewer.id, new Date().toISOString()).all<{ token_hash: string; device_label: string; created_at: string; last_seen_at: string; expires_at: string }>(), getDatabase().prepare(
      `SELECT u.public_id, p.alias, b.created_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id JOIN profiles p ON p.user_id = u.id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 100`,
    ).bind(viewer.id).all()]);
    const safeSessions = await Promise.all(sessions.results.map(async (session) => {
      const { token_hash: tokenHash, ...safe } = session;
      return { ...safe, sessionId: await sessionPublicId(tokenHash), current: tokenHash === viewer.session_token_hash };
    }));
    return Response.json({ sessions: safeSessions, blocks: blocks.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Pengaturan itu belum valid." }, { status: 400 });
    const body = parsed.data;
    const now = new Date().toISOString();

    if (body.action === "profile") {
      const selectedVibes = sanitizeVibes(body.vibes);
      if (!selectedVibes.length) return Response.json({ error: "Pilih setidaknya satu vibe." }, { status: 400 });
      const region = body.locationConsent ? body.region.trim() || null : null;
      const city = body.locationConsent ? body.city.trim() || null : null;
      await getDatabase().batch([
        getDatabase().prepare("UPDATE profiles SET bio = ?, updated_at = ? WHERE user_id = ?").bind(body.bio.trim(), now, viewer.id),
        getDatabase().prepare("UPDATE identities SET region = ?, city = ?, location_consent = ?, age_visibility = ?, contact_type = ?, contact_value = ?, updated_at = ? WHERE user_id = ?").bind(region, city, body.locationConsent ? 1 : 0, body.ageVisibility, body.contactType.trim() || null, body.contactValue.trim() || null, now, viewer.id),
        getDatabase().prepare("DELETE FROM user_vibes WHERE user_id = ?").bind(viewer.id),
        ...selectedVibes.map((vibe) => getDatabase().prepare("INSERT INTO user_vibes (user_id, vibe_id, created_at) VALUES (?, ?, ?)").bind(viewer.id, vibe, now)),
      ]);
      return Response.json({ ok: true });
    }

    if (body.action === "preferences") {
      await getDatabase().prepare(
        "UPDATE preferences SET read_receipts = ?, sensitive_media = ?, reconnect_policy = ?, appearance = ?, push_enabled = ?, updated_at = ? WHERE user_id = ?",
      ).bind(body.readReceipts ? 1 : 0, body.sensitiveMedia, body.reconnectPolicy, body.appearance, body.pushEnabled ? 1 : 0, now, viewer.id).run();
      return Response.json({ ok: true });
    }

    if (body.action === "read_notifications") {
      await getDatabase().prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, viewer.id).run();
      return Response.json({ ok: true });
    }

    if (body.action === "revoke_session") {
      const sessions = await getDatabase().prepare("SELECT token_hash FROM sessions WHERE user_id = ? AND revoked_at IS NULL").bind(viewer.id).all<{ token_hash: string }>();
      let matchedHash: string | null = null;
      for (const session of sessions.results) {
        if (safeEqual(await sessionPublicId(session.token_hash), body.sessionId)) matchedHash = session.token_hash;
      }
      if (!matchedHash) return Response.json({ error: "Sesi itu sudah tidak aktif." }, { status: 404 });
      if (matchedHash === viewer.session_token_hash) return Response.json({ error: "Gunakan Keluar untuk mengakhiri sesi yang sedang dipakai." }, { status: 400 });
      await getDatabase().prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND user_id = ?").bind(now, matchedHash, viewer.id).run();
      return Response.json({ ok: true });
    }

    if (body.action === "unblock") {
      await getDatabase().prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = (SELECT id FROM users WHERE public_id = ?)")
        .bind(viewer.id, body.userPublicId).run();
      return Response.json({ ok: true });
    }

    const credential = await passwordRecord(viewer.id);
    const passwordPepper = requiredSecret("PASSWORD_PEPPER");
    if (!credential || !(await verifyPassword(body.currentPassword, passwordPepper, credential.password_salt, credential.password_hash, credential.password_algorithm, credential.password_iterations))) {
      return Response.json({ error: "Password saat ini belum benar." }, { status: 401 });
    }

    if (body.action === "password") {
      const invalidPassword = passwordError(body.newPassword, viewer.username);
      if (invalidPassword) return Response.json({ error: invalidPassword }, { status: 400 });
      if (body.newPassword !== body.confirmPassword) return Response.json({ error: "Konfirmasi password belum sama." }, { status: 400 });
      const password = await hashPassword(body.newPassword, passwordPepper);
      await getDatabase().batch([
        getDatabase().prepare("UPDATE credentials SET password_hash = ?, password_salt = ?, password_algorithm = ?, password_iterations = ?, password_changed_at = ? WHERE user_id = ?").bind(password.hash, password.salt, password.algorithm, password.iterations, now, viewer.id),
        getDatabase().prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL").bind(now, viewer.id, viewer.session_token_hash),
        getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'password_changed', 'user', ?, '{}', ?)").bind(randomId("aud"), viewer.id, viewer.id, now),
      ]);
      return Response.json({ ok: true, message: "Password diubah dan sesi lain telah dikeluarkan." });
    }

    const recoveryCodes = Array.from({ length: 8 }, () => createRecoveryCode());
    const hashes = await Promise.all(recoveryCodes.map((code) => hmacSha256(requiredSecret("AUTH_SECRET"), normalizeRecoveryCode(code))));
    await getDatabase().batch([
      getDatabase().prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(viewer.id),
      ...hashes.map((hash) => getDatabase().prepare("INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)").bind(randomId("rcv"), viewer.id, hash, now)),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'recovery_codes_rotated', 'user', ?, '{}', ?)").bind(randomId("aud"), viewer.id, viewer.id, now),
    ]);
    return Response.json({ ok: true, recoveryCodes });
  } catch (error) {
    console.error("account_patch_failed", error);
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const parsed = z.object({ password: z.string().max(128), confirmation: z.literal("DELETE MIVO") }).safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Ketik DELETE MIVO dan masukkan password untuk menghapus akun." }, { status: 400 });
    const credential = await passwordRecord(viewer.id);
    if (!credential || !(await verifyPassword(parsed.data.password, requiredSecret("PASSWORD_PEPPER"), credential.password_salt, credential.password_hash, credential.password_algorithm, credential.password_iterations))) {
      return Response.json({ error: "Password belum benar." }, { status: 401 });
    }
    const now = new Date().toISOString();
    const anonymizedUsername = `deleted_${viewer.public_id.slice(-12)}`;
    await getDatabase().batch([
      getDatabase().prepare("UPDATE matchmaking_queue SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status IN ('queued', 'claiming')").bind(now, viewer.id),
      getDatabase().prepare("DELETE FROM active_room_locks WHERE room_id IN (SELECT id FROM rooms WHERE status = 'active' AND (user_a_id = ? OR user_b_id = ?))").bind(viewer.id, viewer.id),
      getDatabase().prepare("UPDATE rooms SET status = 'ended', ended_by_id = ?, end_reason = 'account_deleted', ended_at = ?, retention_until = ?, updated_at = ? WHERE status = 'active' AND (user_a_id = ? OR user_b_id = ?)").bind(viewer.id, now, now, now, viewer.id, viewer.id),
      getDatabase().prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, viewer.id),
      getDatabase().prepare("DELETE FROM credentials WHERE user_id = ?").bind(viewer.id),
      getDatabase().prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(viewer.id),
      getDatabase().prepare("UPDATE identities SET birth_date = '1900-01-01', gender = 'private', region = NULL, city = NULL, photo_key = NULL, contact_type = NULL, contact_value = NULL, age_visibility = 'hidden', location_consent = 0, updated_at = ? WHERE user_id = ?").bind(now, viewer.id),
      getDatabase().prepare("UPDATE profiles SET alias = 'DeletedUser', bio = '', updated_at = ? WHERE user_id = ?").bind(now, viewer.id),
      getDatabase().prepare("UPDATE users SET username = ?, status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").bind(anonymizedUsername, now, now, viewer.id),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'account_deleted', 'user', ?, '{}', ?)").bind(randomId("aud"), viewer.id, now),
    ]);
    if (viewer.photo_key) await getBucket().delete(viewer.photo_key).catch(() => undefined);
    return Response.json({ ok: true }, { headers: { "set-cookie": expiredSessionCookie(request), "cache-control": "no-store" } });
  } catch (error) {
    console.error("account_delete_failed", error);
    return jsonError(error);
  }
}
