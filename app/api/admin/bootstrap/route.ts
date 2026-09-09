import { assertSameOrigin, jsonError, requireViewer, runtimeValue } from "@/lib/server-foundation";
import { getDatabase } from "@/lib/database";
import { randomId, safeEqual } from "@/lib/mivo-core";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const configured = runtimeValue("ADMIN_BOOTSTRAP_TOKEN");
    const supplied = request.headers.get("x-mivo-bootstrap-token") ?? "";
    if (!configured || configured.length < 32 || !(await safeEqual(configured, supplied))) {
      return Response.json({ error: "Bootstrap authorization failed." }, { status: 403 });
    }
    const existing = await getDatabase().prepare("SELECT 1 AS found FROM users WHERE role = 'ADMIN' AND status != 'deleted' LIMIT 1").first();
    if (existing) return Response.json({ error: "An administrator already exists; use the protected admin process to add staff." }, { status: 409 });
    const now = new Date().toISOString();
    try {
      await getDatabase().batch([
        getDatabase().prepare("INSERT INTO admin_bootstrap_state (id, bootstrapped_by_id, created_at) VALUES ('initial', ?, ?) ON CONFLICT(id) DO UPDATE SET bootstrapped_by_id = excluded.bootstrapped_by_id, created_at = excluded.created_at").bind(viewer.id, now),
        getDatabase().prepare("UPDATE users SET role = 'ADMIN', updated_at = ? WHERE id = ?").bind(now, viewer.id),
        getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'admin_bootstrapped', 'user', ?, '{}', ?)").bind(randomId("aud"), viewer.id, viewer.id, now),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unique") || message.includes("duplicate key")) return Response.json({ error: "An administrator already exists; use the protected admin process to add staff." }, { status: 409 });
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
