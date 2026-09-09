import { z } from "zod";

import { getDatabase } from "@/lib/database";
import { randomId } from "@/lib/mivo-core";
import { assertSameOrigin, consumeRateLimit, jsonError, requireViewer } from "@/lib/server-foundation";

const schema = z.object({
  userPublicId: z.string().regex(/^person_[a-zA-Z0-9_-]{16,}$/),
  role: z.enum(["USER", "MODERATOR", "ADMIN"]),
  reason: z.string().trim().min(8).max(500),
});

function adminError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "ADMIN_REQUIRED") return Response.json({ error: "Administrator access is required." }, { status: 403 });
  if (code === "USER_NOT_FOUND") return Response.json({ error: "Active account not found." }, { status: 404 });
  if (code === "LAST_ADMIN") return Response.json({ error: "The last administrator cannot be demoted." }, { status: 409 });
  return jsonError(error);
}

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer(request);
    if (viewer.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
    const staff = await getDatabase().prepare(
      `SELECT u.public_id, u.username, u.role, u.status, u.updated_at, p.alias
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.role IN ('MODERATOR', 'ADMIN') AND u.status != 'deleted'
       ORDER BY CASE u.role WHEN 'ADMIN' THEN 0 ELSE 1 END, u.updated_at DESC LIMIT 100`,
    ).all();
    return Response.json({ staff: staff.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return adminError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    if (viewer.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
    if (!(await consumeRateLimit(request, "staff_role", 20, 3600, viewer.id))) {
      return Response.json({ error: "Too many staff changes. Try again later." }, { status: 429 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A valid account, role, and reason are required." }, { status: 400 });
    const body = parsed.data;
    const target = await getDatabase().prepare("SELECT id, role FROM users WHERE public_id = ? AND status = 'active' LIMIT 1")
      .bind(body.userPublicId).first<{ id: string; role: "USER" | "MODERATOR" | "ADMIN" }>();
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.role === "ADMIN" && body.role !== "ADMIN") {
      const admins = await getDatabase().prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND status = 'active'").first<{ count: number }>();
      if ((admins?.count ?? 0) <= 1) throw new Error("LAST_ADMIN");
    }
    if (target.role === body.role) return Response.json({ ok: true, unchanged: true });
    const now = new Date().toISOString();
    await getDatabase().batch([
      getDatabase().prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(body.role, now, target.id),
      getDatabase().prepare("INSERT INTO moderation_actions (id, moderator_id, target_user_id, report_id, action, reason, created_at) VALUES (?, ?, ?, NULL, 'role_changed', ?, ?)")
        .bind(randomId("mod"), viewer.id, target.id, body.reason, now),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'staff_role_changed', 'user', ?, ?, ?)")
        .bind(randomId("aud"), viewer.id, target.id, JSON.stringify({ from: target.role, to: body.role }), now),
    ]);
    return Response.json({ ok: true, role: body.role });
  } catch (error) {
    return adminError(error);
  }
}
