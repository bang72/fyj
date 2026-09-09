import { getDatabase } from "@/lib/database";
import { consumeRateLimit, jsonError, requireViewer } from "@/lib/server-foundation";

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer(request);
    if (!(await consumeRateLimit(request, "data_export", 3, 86_400, viewer.id))) {
      return Response.json({ error: "Data export is limited to three requests per day." }, { status: 429 });
    }
    const database = getDatabase();
    const [vibes, sessions, ownMessages, connections, blocks, reports, subscriptions, verification] = await Promise.all([
      database.prepare("SELECT vibe_id, created_at FROM user_vibes WHERE user_id = ? ORDER BY created_at").bind(viewer.id).all(),
      database.prepare("SELECT device_label, created_at, last_seen_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC").bind(viewer.id).all(),
      database.prepare(`SELECT m.public_id, r.public_id AS room_public_id, m.sequence, m.kind, m.body, m.delivered_at, m.created_at, m.deleted_at
        FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.sender_id = ? ORDER BY m.created_at`).bind(viewer.id).all(),
      database.prepare(`SELECT c.public_id, c.status, c.created_at, c.updated_at, u.public_id AS partner_public_id, p.alias AS partner_alias
        FROM connections c JOIN users u ON u.id = CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END JOIN profiles p ON p.user_id = u.id
        WHERE c.user_a_id = ? OR c.user_b_id = ? ORDER BY c.created_at`).bind(viewer.id, viewer.id, viewer.id).all(),
      database.prepare(`SELECT u.public_id AS blocked_user_public_id, p.alias, b.created_at
        FROM blocks b JOIN users u ON u.id = b.blocked_id JOIN profiles p ON p.user_id = u.id WHERE b.blocker_id = ? ORDER BY b.created_at`).bind(viewer.id).all(),
      database.prepare("SELECT public_id, category, details, status, priority, created_at, resolved_at FROM reports WHERE reporter_id = ? ORDER BY created_at").bind(viewer.id).all(),
      database.prepare("SELECT provider, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at FROM subscriptions WHERE user_id = ? ORDER BY created_at").bind(viewer.id).all(),
      database.prepare("SELECT status, checked_at, expires_at, updated_at FROM verification_status WHERE user_id = ?").bind(viewer.id).first(),
    ]);
    const exportBody = {
      format: "mivo-account-export-v1",
      generatedAt: new Date().toISOString(),
      account: {
        publicId: viewer.public_id,
        username: viewer.username,
        status: viewer.status,
        role: viewer.role,
        trustBand: viewer.trust_band,
        createdAt: viewer.created_at,
      },
      profile: {
        alias: viewer.alias,
        bio: viewer.bio,
        birthDate: viewer.birth_date,
        gender: viewer.gender,
        ageVisibility: viewer.age_visibility,
        region: viewer.region,
        city: viewer.city,
        locationConsent: Boolean(viewer.location_consent),
        contactType: viewer.contact_type,
        contactValue: viewer.contact_value,
      },
      preferences: {
        desiredGender: viewer.desired_gender,
        readReceipts: Boolean(viewer.read_receipts),
        sensitiveMedia: viewer.sensitive_media,
        reconnectPolicy: viewer.reconnect_policy,
        appearance: viewer.appearance,
        pushEnabled: Boolean(viewer.push_enabled),
      },
      vibes: vibes.results,
      sessions: sessions.results,
      messagesSentByYou: ownMessages.results,
      connections: connections.results,
      blocks: blocks.results,
      reportsYouSubmitted: reports.results,
      subscriptions: subscriptions.results,
      verification,
    };
    return new Response(JSON.stringify(exportBody, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="mivo-data-${viewer.public_id}.json"`,
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
