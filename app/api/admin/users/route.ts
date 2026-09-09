import { z } from "zod";

import { getDatabase } from "@/lib/database";
import { randomId, trustBand } from "@/lib/mivo-core";
import { assertSameOrigin, consumeRateLimit, jsonError, requireViewer } from "@/lib/server-foundation";

const actionSchema = z.object({
  action: z.enum(["warn", "suspend", "ban", "restore", "force_logout", "add_note", "clear_warnings"]),
  userPublicId: z.string().min(8).max(80),
  reason: z.string().trim().min(8).max(1000),
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
  publicNotice: z.string().trim().max(500).optional(),
});

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "STAFF_REQUIRED") return Response.json({ error: "Staff access is required." }, { status: 403 });
  if (code === "ADMIN_REQUIRED") return Response.json({ error: "Administrator access is required for this action." }, { status: 403 });
  if (code === "USER_NOT_FOUND") return Response.json({ error: "Account not found." }, { status: 404 });
  if (code === "PROTECTED_ACCOUNT") return Response.json({ error: "This staff account is protected from that moderation action." }, { status: 409 });
  if (code === "SELF_TARGET") return Response.json({ error: "You cannot apply this action to your own account." }, { status: 409 });
  if (code === "TARGET_ALREADY_BANNED") return Response.json({ error: "This account is permanently banned. Restore it before applying a temporary sanction." }, { status: 409 });
  if (code === "TARGET_DELETED") return Response.json({ error: "Deleted accounts cannot receive moderation actions." }, { status: 409 });
  return jsonError(error);
}

function isStaff(role: string) { return role === "MODERATOR" || role === "ADMIN"; }

function moderationShutdownStatements(userId: string, now: string) {
  const db = getDatabase();
  return [
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId),
    db.prepare("UPDATE matchmaking_queue SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status IN ('queued', 'claiming')").bind(now, userId),
    db.prepare("DELETE FROM active_room_locks WHERE room_id IN (SELECT id FROM rooms WHERE status = 'active' AND (user_a_id = ? OR user_b_id = ?))").bind(userId, userId),
    db.prepare("UPDATE rooms SET status = 'ended', end_reason = 'moderation', ended_by_id = ?, ended_at = ?, retention_until = ?, updated_at = ? WHERE status = 'active' AND (user_a_id = ? OR user_b_id = ?)").bind(userId, now, now, now, userId, userId),
    db.prepare("UPDATE presence SET status = 'offline', updated_at = ? WHERE user_id = ?").bind(now, userId),
  ];
}

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer(request);
    if (!isStaff(viewer.role)) throw new Error("STAFF_REQUIRED");
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
    const status = (url.searchParams.get("status") ?? "all").trim();
    const params: unknown[] = [];
    const filters: string[] = [];
    if (q) {
      filters.push("(LOWER(u.username) LIKE ? OR LOWER(p.alias) LIKE ? OR LOWER(u.public_id) LIKE ?)");
      const pattern = `%${q}%`; params.push(pattern, pattern, pattern);
    }
    if (["active", "suspended", "banned", "deleted"].includes(status)) { filters.push("u.status = ?"); params.push(status); }
    if (viewer.role === "MODERATOR") filters.push("u.role = 'USER'");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const statement = getDatabase().prepare(
      `SELECT u.public_id, u.username, u.status, u.role, u.trust_score, u.trust_band, u.warning_count,
        u.suspended_until, u.moderation_reason, u.last_warning_at, u.created_at, u.updated_at,
        p.alias, p.bio,
        (SELECT COUNT(*) FROM reports r WHERE r.reported_user_id = u.id) AS report_count,
        (SELECT COUNT(*) FROM reports r WHERE r.reported_user_id = u.id AND r.status IN ('open','reviewing')) AS open_report_count,
        (SELECT COUNT(*) FROM moderation_actions ma WHERE ma.target_user_id = u.id) AS action_count,
        (SELECT mn.note FROM moderation_notes mn WHERE mn.target_user_id = u.id ORDER BY mn.created_at DESC LIMIT 1) AS latest_note,
        (SELECT mn.created_at FROM moderation_notes mn WHERE mn.target_user_id = u.id ORDER BY mn.created_at DESC LIMIT 1) AS latest_note_at
       FROM users u JOIN profiles p ON p.user_id = u.id
       ${where}
       ORDER BY CASE u.status WHEN 'banned' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END,
                open_report_count DESC, u.updated_at DESC LIMIT 80`,
    );
    const result = params.length ? await statement.bind(...params).all() : await statement.all();
    return Response.json({ users: result.results, role: viewer.role }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    if (!isStaff(viewer.role)) throw new Error("STAFF_REQUIRED");
    if (!(await consumeRateLimit(request, "moderation_user_action", 80, 3600, viewer.id))) return Response.json({ error: "Too many moderation actions. Try again later." }, { status: 429 });
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A valid account, action, and specific reason are required." }, { status: 400 });
    const body = parsed.data;
    const adminOnly = ["ban", "restore", "force_logout", "clear_warnings"];
    if (adminOnly.includes(body.action) && viewer.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
    if (body.action === "suspend" && viewer.role === "MODERATOR" && (body.durationHours ?? 24) > 24 * 7) throw new Error("ADMIN_REQUIRED");

    const target = await getDatabase().prepare("SELECT id, public_id, username, status, role, trust_score, warning_count FROM users WHERE public_id = ? LIMIT 1")
      .bind(body.userPublicId).first<{ id: string; public_id: string; username: string; status: string; role: string; trust_score: number; warning_count: number }>();
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.id === viewer.id) throw new Error("SELF_TARGET");
    if (target.role === "ADMIN" || (viewer.role === "MODERATOR" && target.role !== "USER")) throw new Error("PROTECTED_ACCOUNT");
    if (target.status === "deleted") throw new Error("TARGET_DELETED");
    if (target.status === "banned" && ["warn", "suspend"].includes(body.action)) throw new Error("TARGET_ALREADY_BANNED");

    const db = getDatabase();
    const now = new Date().toISOString();
    const statements = [];
    let nextStatus = target.status;
    let expiresAt: string | null = null;
    let trustDelta = 0;

    if (body.action === "warn") {
      trustDelta = -4;
      const nextScore = Math.max(0, target.trust_score + trustDelta);
      statements.push(
        db.prepare("UPDATE users SET warning_count = warning_count + 1, last_warning_at = ?, moderation_reason = ?, trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ?").bind(now, body.reason, nextScore, trustBand(nextScore), now, target.id),
        db.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'moderation_warning', 'Peringatan dari MIVO', ?, ?)").bind(randomId("notif"), randomId("notice"), target.id, body.publicNotice || "Akun Anda menerima peringatan karena melanggar pedoman komunitas MIVO.", now),
      );
    } else if (body.action === "suspend") {
      const duration = body.durationHours ?? 24;
      expiresAt = new Date(Date.now() + duration * 3_600_000).toISOString();
      nextStatus = "suspended";
      trustDelta = -12;
      const nextScore = Math.max(0, target.trust_score + trustDelta);
      statements.push(
        db.prepare("UPDATE users SET status = 'suspended', suspended_until = ?, moderation_reason = ?, trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ? AND status != 'deleted'").bind(expiresAt, body.reason, nextScore, trustBand(nextScore), now, target.id),
        db.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'account_suspended', 'Akun ditangguhkan', ?, ?)").bind(randomId("notif"), randomId("notice"), target.id, body.publicNotice || `Akun Anda ditangguhkan sampai ${expiresAt} karena pelanggaran pedoman komunitas MIVO.`, now),
        ...moderationShutdownStatements(target.id, now),
      );
    } else if (body.action === "ban") {
      nextStatus = "banned";
      trustDelta = -30;
      const nextScore = Math.max(0, target.trust_score + trustDelta);
      statements.push(
        db.prepare("UPDATE users SET status = 'banned', suspended_until = NULL, moderation_reason = ?, trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ? AND status != 'deleted'").bind(body.reason, nextScore, trustBand(nextScore), now, target.id),
        ...moderationShutdownStatements(target.id, now),
      );
    } else if (body.action === "restore") {
      nextStatus = "active";
      statements.push(
        db.prepare("UPDATE users SET status = 'active', suspended_until = NULL, moderation_reason = NULL, updated_at = ? WHERE id = ? AND status IN ('suspended','banned')").bind(now, target.id),
        db.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'account_restored', 'Akun dipulihkan', ?, ?)").bind(randomId("notif"), randomId("notice"), target.id, body.publicNotice || "Akun Anda telah dipulihkan oleh administrator MIVO.", now),
      );
    } else if (body.action === "force_logout") {
      statements.push(db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, target.id));
    } else if (body.action === "add_note") {
      statements.push(db.prepare("INSERT INTO moderation_notes (id, target_user_id, author_id, note, created_at) VALUES (?, ?, ?, ?, ?)").bind(randomId("note"), target.id, viewer.id, body.reason, now));
    } else if (body.action === "clear_warnings") {
      statements.push(db.prepare("UPDATE users SET warning_count = 0, last_warning_at = NULL, updated_at = ? WHERE id = ?").bind(now, target.id));
    }

    if (trustDelta !== 0) statements.push(db.prepare("INSERT INTO trust_events (id, user_id, event_type, score_delta, reference_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)").bind(randomId("trust"), target.id, `moderation_${body.action}`, trustDelta, now));
    statements.push(
      db.prepare("INSERT INTO moderation_actions (id, moderator_id, target_user_id, report_id, action, reason, expires_at, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)").bind(randomId("mod"), viewer.id, target.id, body.action, body.reason, expiresAt, now),
      db.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'user_moderation_action', 'user', ?, ?, ?)").bind(randomId("aud"), viewer.id, target.id, JSON.stringify({ action: body.action, expiresAt, previousStatus: target.status, nextStatus }), now),
    );
    await db.batch(statements);
    return Response.json({ ok: true, status: nextStatus, expiresAt });
  } catch (error) { return errorResponse(error); }
}
