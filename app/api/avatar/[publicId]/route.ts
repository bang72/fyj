import { getBucket, getDatabase } from "@/lib/database";
import { jsonError, requireViewer } from "@/lib/server-foundation";

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    const viewer = await requireViewer(request);
    const { publicId } = await context.params;
    const target = await getDatabase().prepare("SELECT u.id, i.photo_key FROM users u JOIN identities i ON i.user_id = u.id WHERE u.public_id = ? AND u.status = 'active' LIMIT 1")
      .bind(publicId).first<{ id: string; photo_key: string | null }>();
    if (!target?.photo_key) return new Response("Not found", { status: 404 });
    if (target.id !== viewer.id) {
      const access = await getDatabase().prepare(
        `SELECT 1 AS allowed FROM rooms r
         JOIN identity_reveal_requests ir ON ir.room_id = r.id AND ir.layer = 3 AND ir.status = 'unlocked'
         WHERE r.status IN ('active', 'ended') AND (r.status = 'active' OR r.retention_until IS NULL OR r.retention_until > ?)
           AND ((r.user_a_id = ? AND r.user_b_id = ?) OR (r.user_a_id = ? AND r.user_b_id = ?))
         UNION ALL
         SELECT 1 AS allowed FROM connections c
         JOIN identity_reveal_requests ir ON ir.room_id = c.source_room_id AND ir.layer = 3 AND ir.status = 'unlocked'
         WHERE c.status = 'active' AND ((c.user_a_id = ? AND c.user_b_id = ?) OR (c.user_a_id = ? AND c.user_b_id = ?))
         LIMIT 1`,
      ).bind(new Date().toISOString(), viewer.id, target.id, target.id, viewer.id, viewer.id, target.id, target.id, viewer.id).first();
      if (!access) return new Response("Not found", { status: 404 });
    }
    const object = await getBucket().get(target.photo_key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    object.writeHttpMetadata?.(headers);
    if (!headers.has("content-type") && object.httpMetadata?.contentType) headers.set("content-type", object.httpMetadata.contentType);
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(error);
  }
}
