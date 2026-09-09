import { getDatabase, storageConfigured } from "@/lib/database";
import { VIBES, ageFromBirthDate, safeJsonArray } from "@/lib/mivo-core";
import { activeRoomForUser, entitlementForUser } from "@/lib/matchmaking";
import { realtimeEnabled } from "@/lib/realtime";
import { hydrateRoom, getMessages } from "@/lib/rooms";
import { ensureReferenceData, getViewer, jsonError, runMaintenance, runtimeValue } from "@/lib/server-foundation";

export async function GET(request: Request) {
  try {
    await ensureReferenceData();
    await runMaintenance();
    const viewer = await getViewer(request);
    const hasRealtime = realtimeEnabled();
    const capabilities = {
      realtime: hasRealtime,
      transport: hasRealtime ? "ably" as const : "polling" as const,
      version: "2.1.0",
      billing: (runtimeValue("PAYMENT_PROVIDER") ?? "stripe") === "stripe" && Boolean(runtimeValue("STRIPE_SECRET_KEY") && runtimeValue("STRIPE_WEBHOOK_SECRET") && runtimeValue("STRIPE_PRICE_PLUS") && runtimeValue("STRIPE_PRICE_MAX")),
      // Intentionally disabled until a reviewed provider, consent text, lawful basis,
      // and retention/deletion contract are implemented together.
      verification: false,
      media: storageConfigured(),
    };
    if (!viewer) return Response.json({ authenticated: false, vibes: VIBES, capabilities }, { headers: { "cache-control": "no-store" } });
    const now = new Date().toISOString();
    const [userVibes, entitlement, queue, active, connections, notifications, secondChances, verification] = await Promise.all([
      getDatabase().prepare("SELECT vibe_id FROM user_vibes WHERE user_id = ? ORDER BY created_at ASC").bind(viewer.id).all<{ vibe_id: string }>(),
      entitlementForUser(viewer.id),
      getDatabase().prepare("SELECT status, desired_gender, vibes_json, expanded, created_at FROM matchmaking_queue WHERE user_id = ? AND status IN ('queued', 'claiming') LIMIT 1").bind(viewer.id).first<{ status: string; desired_gender: string; vibes_json: string; expanded: number; created_at: string }>(),
      activeRoomForUser(viewer.id),
      getDatabase().prepare(
        `SELECT c.public_id, c.created_at, source.public_id AS source_room_public_id,
          other.public_id AS partner_public_id, other.trust_band,
          p.alias AS partner_alias, p.avatar_hue
         FROM connections c
         JOIN users other ON other.id = CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END
         JOIN profiles p ON p.user_id = other.id
         LEFT JOIN rooms source ON source.id = c.source_room_id
         WHERE c.status = 'active' AND (c.user_a_id = ? OR c.user_b_id = ?)
         ORDER BY c.updated_at DESC LIMIT 50`,
      ).bind(viewer.id, viewer.id, viewer.id).all(),
      getDatabase().prepare("SELECT public_id, type, title, body, entity_public_id, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40").bind(viewer.id).all(),
      getDatabase().prepare(
        `SELECT scr.id, r.public_id AS room_public_id, p.alias AS requester_alias, scr.expires_at
         FROM second_chance_requests scr
         JOIN rooms r ON r.id = scr.room_id
         JOIN profiles p ON p.user_id = scr.requested_by_id
         WHERE scr.target_id = ? AND scr.target_decision = 'pending' AND scr.expires_at > ?
         ORDER BY scr.created_at DESC LIMIT 10`,
      ).bind(viewer.id, now).all(),
      getDatabase().prepare("SELECT status FROM verification_status WHERE user_id = ?").bind(viewer.id).first<{ status: string }>(),
    ]);
    const room = active ? await hydrateRoom(viewer, active.public_id) : null;
    const messages = active ? await getMessages(viewer, active.public_id, { limit: 40 }) : [];
    return Response.json({
      authenticated: true,
      viewer: {
        publicId: viewer.public_id,
        status: viewer.status,
        username: viewer.username,
        alias: viewer.alias,
        avatarHue: viewer.avatar_hue,
        photoUrl: viewer.photo_key ? `/api/avatar/${viewer.public_id}` : null,
        bio: viewer.bio,
        age: ageFromBirthDate(viewer.birth_date),
        birthDate: viewer.birth_date,
        gender: viewer.gender,
        region: viewer.region,
        city: viewer.city,
        locationConsent: Boolean(viewer.location_consent),
        ageVisibility: viewer.age_visibility,
        contactType: viewer.contact_type,
        contactValue: viewer.contact_value,
        desiredGender: viewer.desired_gender,
        readReceipts: Boolean(viewer.read_receipts),
        sensitiveMedia: viewer.sensitive_media,
        reconnectPolicy: viewer.reconnect_policy,
        appearance: viewer.appearance,
        pushEnabled: Boolean(viewer.push_enabled),
        trustBand: viewer.trust_band,
        verifiedHuman: verification?.status === "verified",
        role: viewer.role,
        vibes: userVibes.results.map((row) => row.vibe_id),
        createdAt: viewer.created_at,
      },
      vibes: VIBES,
      entitlement,
      search: queue ? { state: queue.status === "claiming" ? "searching" : "queued", desiredGender: queue.desired_gender, vibes: safeJsonArray(queue.vibes_json), expanded: Boolean(queue.expanded), since: queue.created_at } : { state: "idle" },
      room,
      messages,
      connections: connections.results,
      notifications: notifications.results,
      secondChances: secondChances.results,
      capabilities,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("bootstrap_failed", error);
    return jsonError(error);
  }
}
