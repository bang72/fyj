import { getDatabase } from "@/lib/database";
import { jsonError, requireViewer } from "@/lib/server-foundation";

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer(request);
    if (viewer.role !== "ADMIN") return Response.json({ error: "Administrator access is required." }, { status: 403 });
    const actions = await getDatabase().prepare(
      `SELECT ma.id, ma.action, ma.reason, ma.expires_at, ma.created_at,
        actor.public_id AS actor_public_id, actor_profile.alias AS actor_alias, actor.role AS actor_role,
        target.public_id AS target_public_id, target_profile.alias AS target_alias, target.status AS target_status,
        r.public_id AS report_public_id
       FROM moderation_actions ma
       JOIN users actor ON actor.id = ma.moderator_id JOIN profiles actor_profile ON actor_profile.user_id = actor.id
       JOIN users target ON target.id = ma.target_user_id JOIN profiles target_profile ON target_profile.user_id = target.id
       LEFT JOIN reports r ON r.id = ma.report_id
       ORDER BY ma.created_at DESC LIMIT 200`,
    ).all();
    return Response.json({ actions: actions.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
