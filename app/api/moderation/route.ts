import { z } from "zod";

import { getDatabase } from "@/lib/database";
import { randomId, trustBand } from "@/lib/mivo-core";
import { assertSameOrigin, consumeRateLimit, jsonError, requireViewer } from "@/lib/server-foundation";

const actionSchema = z.object({
  action: z.enum(["review", "resolve", "dismiss", "assign", "unassign", "note", "set_priority", "remove_content", "warn", "suspend", "ban", "restore"]),
  reportPublicId: z.string().min(8).max(80),
  reason: z.string().trim().min(8).max(1000),
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
  priority: z.number().int().min(0).max(20).optional(),
  publicNotice: z.string().trim().max(500).optional(),
});

function requireStaff(role: string) { if (role !== "MODERATOR" && role !== "ADMIN") throw new Error("STAFF_REQUIRED"); }
function moderationError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "STAFF_REQUIRED") return Response.json({ error: "Moderator access is required." }, { status: 403 });
  if (code === "ADMIN_REQUIRED") return Response.json({ error: "Administrator access is required for this action." }, { status: 403 });
  if (code === "REPORT_NOT_FOUND") return Response.json({ error: "Report not found." }, { status: 404 });
  if (code === "PROTECTED_ACCOUNT") return Response.json({ error: "This staff account is protected from that moderation action." }, { status: 409 });
  if (code === "SELF_TARGET") return Response.json({ error: "You cannot moderate your own account through a report." }, { status: 409 });
  if (code === "TARGET_ALREADY_BANNED") return Response.json({ error: "This account is already permanently banned. Restore it before applying a temporary sanction." }, { status: 409 });
  if (code === "TARGET_DELETED") return Response.json({ error: "Deleted accounts cannot receive moderation sanctions." }, { status: 409 });
  return jsonError(error);
}

function shutdownStatements(userId: string, now: string) {
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
    requireStaff(viewer.role);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "open";
    const allowed = ["open", "reviewing", "resolved", "dismissed", "all"];
    const selected = allowed.includes(status) ? status : "open";
    const mine = url.searchParams.get("mine") === "1";
    const filters: string[] = [];
    const values: unknown[] = [];
    if (selected !== "all") { filters.push("r.status = ?"); values.push(selected); }
    if (mine) { filters.push("r.assigned_moderator_id = ?"); values.push(viewer.id); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const query = getDatabase().prepare(
      `SELECT r.public_id, r.category, r.details, r.status, r.priority, r.created_at, r.updated_at, r.resolved_at,
        r.resolution_code, r.internal_note,
        reporter.public_id AS reporter_public_id, reporter_profile.alias AS reporter_alias,
        target.public_id AS target_public_id, target.status AS target_status, target.role AS target_role,
        target.trust_band AS target_trust_band, target.trust_score AS target_trust_score,
        target.warning_count AS target_warning_count, target.suspended_until AS target_suspended_until,
        target.moderation_reason AS target_moderation_reason,
        target_profile.alias AS target_alias, room.public_id AS room_public_id,
        message.public_id AS message_public_id, evidence.snapshot AS evidence_snapshot, evidence.expires_at AS evidence_expires_at,
        assigned.public_id AS assigned_public_id, assigned_profile.alias AS assigned_alias
       FROM reports r
       JOIN users reporter ON reporter.id = r.reporter_id JOIN profiles reporter_profile ON reporter_profile.user_id = reporter.id
       JOIN users target ON target.id = r.reported_user_id JOIN profiles target_profile ON target_profile.user_id = target.id
       LEFT JOIN users assigned ON assigned.id = r.assigned_moderator_id LEFT JOIN profiles assigned_profile ON assigned_profile.user_id = assigned.id
       LEFT JOIN rooms room ON room.id = r.room_id LEFT JOIN messages message ON message.id = r.message_id
       LEFT JOIN report_evidence evidence ON evidence.report_id = r.id
       ${where} ORDER BY r.priority DESC, r.created_at ASC LIMIT 120`,
    );
    const reports = values.length ? await query.bind(...values).all() : await query.all();
    return Response.json({ role: viewer.role, viewerPublicId: viewer.public_id, reports: reports.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return moderationError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    requireStaff(viewer.role);
    if (!(await consumeRateLimit(request, "moderation_report_action", 100, 3600, viewer.id))) return Response.json({ error: "Too many moderation actions. Try again later." }, { status: 429 });
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A report, action, and specific moderation reason are required." }, { status: 400 });
    const body = parsed.data;
    if (["ban", "restore"].includes(body.action) && viewer.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
    if (body.action === "suspend" && viewer.role === "MODERATOR" && (body.durationHours ?? 24) > 24 * 7) throw new Error("ADMIN_REQUIRED");

    const report = await getDatabase().prepare(
      `SELECT r.id, r.reported_user_id, r.message_id, r.status,
        u.public_id AS target_public_id, u.role AS target_role, u.status AS target_status, u.trust_score, u.warning_count
       FROM reports r JOIN users u ON u.id = r.reported_user_id WHERE r.public_id = ? LIMIT 1`,
    ).bind(body.reportPublicId).first<{ id: string; reported_user_id: string; message_id: string | null; status: string; target_public_id: string; target_role: string; target_status: string; trust_score: number; warning_count: number }>();
    if (!report) throw new Error("REPORT_NOT_FOUND");
    if (report.reported_user_id === viewer.id) throw new Error("SELF_TARGET");
    if (["warn", "suspend", "ban", "restore"].includes(body.action)) {
      if (report.target_role === "ADMIN" || (viewer.role === "MODERATOR" && report.target_role !== "USER")) throw new Error("PROTECTED_ACCOUNT");
      if (report.target_status === "deleted") throw new Error("TARGET_DELETED");
      if (report.target_status === "banned" && ["warn", "suspend"].includes(body.action)) throw new Error("TARGET_ALREADY_BANNED");
    }

    const db = getDatabase();
    const now = new Date().toISOString();
    const statements = [];
    let expiresAt: string | null = null;
    let audit: Record<string, unknown> = { action: body.action };

    if (body.action === "review") {
      statements.push(db.prepare("UPDATE reports SET status = 'reviewing', assigned_moderator_id = COALESCE(assigned_moderator_id, ?), updated_at = ? WHERE id = ? AND status IN ('open','reviewing')").bind(viewer.id, now, report.id));
    } else if (body.action === "assign") {
      statements.push(db.prepare("UPDATE reports SET assigned_moderator_id = ?, status = CASE WHEN status = 'open' THEN 'reviewing' ELSE status END, updated_at = ? WHERE id = ?").bind(viewer.id, now, report.id));
    } else if (body.action === "unassign") {
      statements.push(db.prepare("UPDATE reports SET assigned_moderator_id = NULL, updated_at = ? WHERE id = ?").bind(now, report.id));
    } else if (body.action === "note") {
      statements.push(db.prepare("UPDATE reports SET internal_note = ?, updated_at = ? WHERE id = ?").bind(body.reason, now, report.id));
    } else if (body.action === "set_priority") {
      const priority = body.priority ?? 0;
      audit.priority = priority;
      statements.push(db.prepare("UPDATE reports SET priority = ?, updated_at = ? WHERE id = ?").bind(priority, now, report.id));
    } else if (body.action === "resolve" || body.action === "dismiss") {
      const next = body.action === "resolve" ? "resolved" : "dismissed";
      statements.push(db.prepare("UPDATE reports SET status = ?, resolution_code = ?, internal_note = ?, assigned_moderator_id = COALESCE(assigned_moderator_id, ?), resolved_at = ?, updated_at = ? WHERE id = ?").bind(next, body.action, body.reason, viewer.id, now, now, report.id));
    } else if (body.action === "remove_content") {
      if (!report.message_id) return Response.json({ error: "This report is not linked to a message." }, { status: 409 });
      statements.push(
        db.prepare("UPDATE messages SET body = '[Removed by moderation]', body_hash = NULL, deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(now, report.message_id),
        db.prepare("UPDATE reports SET status = 'resolved', resolution_code = 'content_removed', internal_note = ?, assigned_moderator_id = COALESCE(assigned_moderator_id, ?), resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.reason, viewer.id, now, now, report.id),
      );
    } else if (body.action === "warn") {
      const nextScore = Math.max(0, report.trust_score - 4);
      statements.push(
        db.prepare("UPDATE users SET warning_count = warning_count + 1, last_warning_at = ?, moderation_reason = ?, trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ?").bind(now, body.reason, nextScore, trustBand(nextScore), now, report.reported_user_id),
        db.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'moderation_warning', 'Peringatan dari MIVO', ?, ?)").bind(randomId("notif"), randomId("notice"), report.reported_user_id, body.publicNotice || "Akun Anda menerima peringatan karena melanggar pedoman komunitas MIVO.", now),
        db.prepare("INSERT INTO trust_events (id, user_id, event_type, score_delta, reference_id, created_at) VALUES (?, ?, 'moderation_warn', -4, ?, ?)").bind(randomId("trust"), report.reported_user_id, report.id, now),
        db.prepare("UPDATE reports SET status = 'resolved', resolution_code = 'warning', internal_note = ?, assigned_moderator_id = COALESCE(assigned_moderator_id, ?), resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.reason, viewer.id, now, now, report.id),
      );
    } else if (body.action === "suspend") {
      const durationHours = body.durationHours ?? 24;
      expiresAt = new Date(Date.now() + durationHours * 3_600_000).toISOString();
      const nextScore = Math.max(0, report.trust_score - 12);
      audit.durationHours = durationHours; audit.expiresAt = expiresAt;
      statements.push(
        db.prepare("UPDATE users SET status = 'suspended', suspended_until = ?, moderation_reason = ?, trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ? AND status != 'deleted'").bind(expiresAt, body.reason, nextScore, trustBand(nextScore), now, report.reported_user_id),
        db.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'account_suspended', 'Akun ditangguhkan', ?, ?)").bind(randomId("notif"), randomId("notice"), report.reported_user_id, body.publicNotice || `Akun Anda ditangguhkan sampai ${expiresAt} karena pelanggaran pedoman komunitas MIVO.`, now),
        db.prepare("INSERT INTO trust_events (id, user_id, event_type, score_delta, reference_id, created_at) VALUES (?, ?, 'moderation_suspend', -12, ?, ?)").bind(randomId("trust"), report.reported_user_id, report.id, now),
        db.prepare("UPDATE reports SET status = 'resolved', resolution_code = 'suspended', internal_note = ?, assigned_moderator_id = COALESCE(assigned_moderator_id, ?), resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.reason, viewer.id, now, now, report.id),
        ...shutdownStatements(report.reported_user_id, now),
      );
    } else if (body.action === "ban") {
      const nextScore = Math.max(0, report.trust_score - 30);
      statements.push(
        db.prepare("UPDATE users SET status = 'banned', suspended_until = NULL, moderation_reason = ?, trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ? AND status != 'deleted'").bind(body.reason, nextScore, trustBand(nextScore), now, report.reported_user_id),
        db.prepare("INSERT INTO trust_events (id, user_id, event_type, score_delta, reference_id, created_at) VALUES (?, ?, 'moderation_ban', -30, ?, ?)").bind(randomId("trust"), report.reported_user_id, report.id, now),
        db.prepare("UPDATE reports SET status = 'resolved', resolution_code = 'permanent_ban', internal_note = ?, assigned_moderator_id = COALESCE(assigned_moderator_id, ?), resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.reason, viewer.id, now, now, report.id),
        ...shutdownStatements(report.reported_user_id, now),
      );
    } else if (body.action === "restore") {
      statements.push(
        db.prepare("UPDATE users SET status = 'active', suspended_until = NULL, moderation_reason = NULL, updated_at = ? WHERE id = ? AND status IN ('suspended','banned')").bind(now, report.reported_user_id),
        db.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'account_restored', 'Akun dipulihkan', ?, ?)").bind(randomId("notif"), randomId("notice"), report.reported_user_id, body.publicNotice || "Akun Anda telah dipulihkan oleh administrator MIVO.", now),
      );
    }

    if (["warn", "suspend", "ban", "restore", "remove_content", "resolve", "dismiss"].includes(body.action)) {
      statements.push(db.prepare("INSERT INTO moderation_actions (id, moderator_id, target_user_id, report_id, action, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(randomId("mod"), viewer.id, report.reported_user_id, report.id, body.action, body.reason, expiresAt, now));
    }
    statements.push(db.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'report_moderation_action', 'report', ?, ?, ?)").bind(randomId("aud"), viewer.id, report.id, JSON.stringify(audit), now));
    await db.batch(statements);
    return Response.json({ ok: true, expiresAt });
  } catch (error) {
    console.error("moderation_action_failed", error);
    return moderationError(error);
  }
}
