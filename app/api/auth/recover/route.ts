import { z } from "zod";

import { getDatabase } from "@/lib/database";
import { hashPassword, hmacSha256, normalizeRecoveryCode, normalizeUsername, passwordError } from "@/lib/mivo-core";
import { assertSameOrigin, consumeRateLimit, jsonError, prepareSession, requiredSecret } from "@/lib/server-foundation";

const schema = z.object({
  username: z.string().max(80),
  recoveryCode: z.string().min(8).max(40),
  newPassword: z.string().max(128),
  confirmPassword: z.string().max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await consumeRateLimit(request, "recover", 8, 3600))) return Response.json({ error: "Terlalu banyak percobaan pemulihan. Coba lagi nanti." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Data pemulihan belum lengkap." }, { status: 400 });
    const username = normalizeUsername(parsed.data.username);
    const invalidPassword = passwordError(parsed.data.newPassword, username);
    if (invalidPassword) return Response.json({ error: invalidPassword }, { status: 400 });
    if (parsed.data.newPassword !== parsed.data.confirmPassword) return Response.json({ error: "Konfirmasi password belum sama." }, { status: 400 });
    const codeHash = await hmacSha256(requiredSecret("AUTH_SECRET"), normalizeRecoveryCode(parsed.data.recoveryCode));
    const recovery = await getDatabase().prepare(
      `SELECT r.id AS recovery_id, u.id AS user_id, u.status
       FROM recovery_codes r JOIN users u ON u.id = r.user_id
       WHERE u.username = ? AND r.code_hash = ? AND r.used_at IS NULL LIMIT 1`,
    ).bind(username, codeHash).first<{ recovery_id: string; user_id: string; status: string }>();
    if (!recovery || recovery.status !== "active") return Response.json({ error: "Username atau recovery code tidak cocok." }, { status: 401 });
    const password = await hashPassword(parsed.data.newPassword, requiredSecret("PASSWORD_PEPPER"));
    const now = new Date().toISOString();
    const claimMarker = `${now}#${crypto.randomUUID()}`;
    const session = await prepareSession(recovery.user_id, request);
    const claimed = await getDatabase().batch([
      getDatabase().prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(claimMarker, recovery.recovery_id),
      getDatabase().prepare("UPDATE credentials SET password_hash = ?, password_salt = ?, password_algorithm = ?, password_iterations = ?, password_changed_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM recovery_codes WHERE id = ? AND used_at = ?)").bind(password.hash, password.salt, password.algorithm, password.iterations, now, recovery.user_id, recovery.recovery_id, claimMarker),
      getDatabase().prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM recovery_codes WHERE id = ? AND used_at = ?)").bind(now, recovery.user_id, recovery.recovery_id, claimMarker),
    ]);
    if ((claimed[0]?.meta.changes ?? 0) !== 1) return Response.json({ error: "Recovery code itu sudah digunakan." }, { status: 409 });
    await getDatabase().batch([
      getDatabase().prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at = ?").bind(now, recovery.recovery_id, claimMarker),
      session.statement,
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'account_recovered', 'user', ?, '{}', ?)").bind(`aud_${crypto.randomUUID()}`, recovery.user_id, recovery.user_id, now),
    ]);
    return Response.json({ ok: true, message: "Password berhasil diubah. Recovery code itu sudah tidak dapat dipakai lagi." }, { headers: { "set-cookie": session.cookie, "cache-control": "no-store" } });
  } catch (error) {
    console.error("recover_failed", error);
    return jsonError(error);
  }
}
