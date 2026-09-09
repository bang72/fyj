import { getDatabase } from "@/lib/database";
import { jsonError, requireViewer } from "@/lib/server-foundation";

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer(request);
    if (viewer.role !== "MODERATOR" && viewer.role !== "ADMIN") return Response.json({ error: "Staff access is required." }, { status: 403 });
    const db = getDatabase();
    const [users, reports, actions, appeals] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'suspended') AS suspended,
        COUNT(*) FILTER (WHERE status = 'banned') AS banned
        FROM users WHERE status != 'deleted'`).first(),
      db.prepare(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'reviewing') AS reviewing,
        COUNT(*) FILTER (WHERE priority >= 10 AND status IN ('open','reviewing')) AS urgent
        FROM reports`).first(),
      db.prepare("SELECT COUNT(*) AS today FROM moderation_actions WHERE created_at >= ?").bind(new Date(Date.now() - 86_400_000).toISOString()).first(),
      db.prepare("SELECT COUNT(*) AS open FROM moderation_appeals WHERE status = 'open'").first(),
    ]);
    return Response.json({ users, reports, actions, appeals, role: viewer.role }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
