
import { getDatabase } from "@/lib/database";
import {
  REPORT_CATEGORIES,
  agePresentation,
  containsSuspiciousUrl,
  orderedPair,
  publicId,
  randomId,
  retentionDecision,
  selectIcebreaker,
  sha256,
  trustBand,
  type RetentionChoice,
} from "@/lib/mivo-core";
import { activeRoomForUser } from "@/lib/matchmaking";
import { publishRealtime } from "@/lib/realtime";
import { createNotification, type Viewer } from "@/lib/server-foundation";

type RoomAccess = {
  id: string;
  public_id: string;
  user_a_id: string;
  user_b_id: string;
  status: "active" | "ended" | "expired";
  match_mode: string;
  vibe_score: number;
  message_seq: number;
  message_count: number;
  created_at: string;
  ended_at: string | null;
  end_reason: string | null;
  retention_until: string | null;
  mine_alias: string;
  mine_level: "stranger" | "familiar" | "vibe" | "connected";
  mine_retention: RetentionChoice;
  mine_last_read: number;
  partner_id: string;
  partner_public_id: string;
  partner_alias: string;
  partner_level: "stranger" | "familiar" | "vibe" | "connected";
  partner_retention: RetentionChoice;
  partner_last_read: number;
  partner_typing_until: string | null;
  partner_trust_band: "new" | "established" | "trusted";
  partner_birth_date: string;
  partner_age_visibility: "range" | "exact" | "hidden";
  partner_region: string | null;
  partner_city: string | null;
  partner_location_consent: number;
  partner_photo_key: string | null;
  partner_contact_type: string | null;
  partner_contact_value: string | null;
  partner_verified: string;
  partner_read_receipts: number;
  partner_presence_status: "online" | "searching" | "chatting" | "away" | "offline" | null;
  partner_last_heartbeat_at: string | null;
};

export async function requireRoom(viewer: Viewer, roomPublicId: string, allowEnded = true) {
  const statusClause = allowEnded ? "r.status IN ('active', 'ended')" : "r.status = 'active'";
  const room = await getDatabase().prepare(
    `SELECT r.*, mine.anonymous_alias AS mine_alias, mine.connection_level AS mine_level,
      mine.retention_choice AS mine_retention, mine.last_read_seq AS mine_last_read,
      partner.user_id AS partner_id, partner.anonymous_alias AS partner_alias,
      partner.connection_level AS partner_level, partner.retention_choice AS partner_retention,
      partner.last_read_seq AS partner_last_read, partner.typing_until AS partner_typing_until,
      other.public_id AS partner_public_id, other.trust_band AS partner_trust_band,
      oi.birth_date AS partner_birth_date, oi.age_visibility AS partner_age_visibility,
      oi.region AS partner_region, oi.city AS partner_city, oi.location_consent AS partner_location_consent,
      oi.photo_key AS partner_photo_key, oi.contact_type AS partner_contact_type,
      oi.contact_value AS partner_contact_value, COALESCE(vs.status, 'not_started') AS partner_verified,
      op.read_receipts AS partner_read_receipts,
      pp.status AS partner_presence_status, pp.last_heartbeat_at AS partner_last_heartbeat_at
     FROM rooms r
     JOIN room_members mine ON mine.room_id = r.id AND mine.user_id = ?
     JOIN room_members partner ON partner.room_id = r.id AND partner.user_id != ?
     JOIN users other ON other.id = partner.user_id
     JOIN identities oi ON oi.user_id = other.id
     JOIN preferences op ON op.user_id = other.id
     LEFT JOIN presence pp ON pp.user_id = other.id
     LEFT JOIN verification_status vs ON vs.user_id = other.id
     WHERE r.public_id = ? AND ${statusClause} LIMIT 1`,
  ).bind(viewer.id, viewer.id, roomPublicId).first<RoomAccess>();
  if (!room) throw new Error("ROOM_NOT_FOUND");
  return room;
}

async function roomRevealState(room: RoomAccess, viewer: Viewer) {
  const reveals = await getDatabase().prepare(
    "SELECT layer, status, user_a_approved, user_b_approved FROM identity_reveal_requests WHERE room_id = ? ORDER BY layer ASC",
  ).bind(room.id).all<{ layer: number; status: string; user_a_approved: number | null; user_b_approved: number | null }>();
  return reveals.results.map((reveal) => ({
    layer: reveal.layer,
    status: reveal.status,
    myDecision: viewer.id === room.user_a_id ? reveal.user_a_approved : reveal.user_b_approved,
  }));
}

export async function hydrateRoom(viewer: Viewer, roomPublicId: string) {
  const room = await requireRoom(viewer, roomPublicId);
  const [reveals, commonVibes, vibeCheck] = await Promise.all([
    roomRevealState(room, viewer),
    getDatabase().prepare(
      `SELECT v.id, v.label FROM user_vibes mine
       JOIN user_vibes theirs ON theirs.vibe_id = mine.vibe_id AND theirs.user_id = ?
       JOIN vibes v ON v.id = mine.vibe_id
       WHERE mine.user_id = ? ORDER BY v.position ASC LIMIT 3`,
    ).bind(room.partner_id, viewer.id).all<{ id: string; label: string }>(),
    getDatabase().prepare("SELECT user_a_choice, user_b_choice, result FROM vibe_checks WHERE room_id = ? LIMIT 1")
      .bind(room.id).first<{ user_a_choice: string | null; user_b_choice: string | null; result: string }>(),
  ]);
  const unlocked = new Set(reveals.filter((reveal) => reveal.status === "unlocked").map((reveal) => reveal.layer));
  const partner: Record<string, unknown> = {
    publicId: room.partner_public_id,
    alias: room.partner_alias,
    trustBand: room.partner_trust_band,
    verifiedHuman: room.partner_verified === "verified",
    connectionLevel: room.partner_level,
    connectionState: room.partner_last_heartbeat_at && Date.now() - new Date(room.partner_last_heartbeat_at).getTime() <= 90_000
      ? room.partner_presence_status === "away" ? "away" : "online"
      : "offline",
    vibes: commonVibes.results,
  };
  if (unlocked.has(1)) partner.age = agePresentation(room.partner_birth_date, room.partner_age_visibility);
  if (unlocked.has(2) && room.partner_location_consent) partner.location = [room.partner_city, room.partner_region].filter(Boolean).join(", ") || null;
  if (unlocked.has(3) && room.partner_photo_key) partner.photoUrl = `/api/avatar/${room.partner_public_id}`;
  if (unlocked.has(4)) partner.contact = room.partner_contact_value ? { type: room.partner_contact_type, value: room.partner_contact_value } : null;
  const myVibeChoice = vibeCheck ? (viewer.id === room.user_a_id ? vibeCheck.user_a_choice : vibeCheck.user_b_choice) : null;
  return {
    publicId: room.public_id,
    status: room.status,
    matchMode: room.match_mode,
    createdAt: room.created_at,
    endedAt: room.ended_at,
    endReason: room.end_reason,
    retentionUntil: room.retention_until,
    messageCount: room.message_count,
    latestSequence: room.message_seq,
    myRetention: room.mine_retention,
    partnerTyping: Boolean(room.partner_typing_until && room.partner_typing_until > new Date().toISOString()),
    partner,
    reveals,
    vibeCheck: { myChoice: myVibeChoice, result: vibeCheck?.result ?? "available" },
  };
}

export async function getMessages(viewer: Viewer, roomPublicId: string, options: { before?: number; after?: number; limit?: number } = {}) {
  const room = await requireRoom(viewer, roomPublicId);
  const limit = Math.max(1, Math.min(options.limit ?? 40, 60));
  let where = "m.room_id = ?";
  const values: unknown[] = [room.id];
  let order = "DESC";
  if (options.before && options.before > 0) {
    where += " AND m.sequence < ?";
    values.push(options.before);
  }
  if (options.after && options.after >= 0) {
    where += " AND m.sequence > ?";
    values.push(options.after);
    order = "ASC";
  }
  values.push(limit);
  const rows = await getDatabase().prepare(
    `SELECT m.public_id, m.sender_id, m.sequence, m.kind, m.body, m.reply_to_id,
      m.delivered_at, m.created_at, m.deleted_at, reply.body AS reply_body,
      reply.public_id AS reply_public_id
     FROM messages m LEFT JOIN messages reply ON reply.id = m.reply_to_id
     WHERE ${where} ORDER BY m.sequence ${order} LIMIT ?`,
  ).bind(...values).all<{
    public_id: string; sender_id: string | null; sequence: number; kind: string; body: string;
    reply_to_id: string | null; delivered_at: string; created_at: string; deleted_at: string | null;
    reply_body: string | null; reply_public_id: string | null;
  }>();
  const sorted = order === "DESC" ? rows.results.reverse() : rows.results;
  return sorted.map((message) => ({
    publicId: message.public_id,
    sender: message.sender_id === viewer.id ? "me" : message.sender_id ? "them" : "system",
    sequence: message.sequence,
    kind: message.kind,
    body: message.deleted_at ? "Message deleted" : message.body,
    reply: message.reply_public_id ? { publicId: message.reply_public_id, body: message.reply_body?.slice(0, 160) ?? "Message" } : null,
    deliveredAt: message.delivered_at,
    createdAt: message.created_at,
    read: message.sender_id === viewer.id && Boolean(room.partner_read_receipts) && room.partner_last_read >= message.sequence,
    suspiciousUrl: containsSuspiciousUrl(message.body),
  }));
}

async function insertRoomMessage(room: RoomAccess, senderId: string | null, kind: "text" | "icebreaker" | "system", body: string, replyToId: string | null, bodyHash: string | null) {
  const sequenceRow = await getDatabase().prepare(
    "UPDATE rooms SET message_seq = message_seq + 1, message_count = message_count + ?, updated_at = ? WHERE id = ? AND status = 'active' RETURNING message_seq, message_count",
  ).bind(kind === "text" ? 1 : 0, new Date().toISOString(), room.id).first<{ message_seq: number; message_count: number }>();
  if (!sequenceRow) throw new Error("ROOM_ENDED");
  const id = randomId("msg");
  const messagePublicId = publicId("msg");
  const now = new Date().toISOString();
  await getDatabase().prepare(
    "INSERT INTO messages (id, public_id, room_id, sender_id, sequence, kind, body, body_hash, reply_to_id, delivered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, messagePublicId, room.id, senderId, sequenceRow.message_seq, kind, body, bodyHash, replyToId, now, now).run();

  if (kind === "text" && sequenceRow.message_count >= 8 && Date.now() - new Date(room.created_at).getTime() >= 120_000) {
    const participation = await getDatabase().prepare(
      "SELECT COUNT(DISTINCT sender_id) AS senders FROM messages WHERE room_id = ? AND kind = 'text' AND sender_id IS NOT NULL",
    ).bind(room.id).first<{ senders: number }>();
    if ((participation?.senders ?? 0) === 2) {
      await getDatabase().prepare("UPDATE room_members SET connection_level = 'familiar' WHERE room_id = ? AND connection_level = 'stranger'").bind(room.id).run();
    }
  }
  await publishRealtime(`room:${room.public_id}`, "room.updated", { roomPublicId: room.public_id, latestSequence: sequenceRow.message_seq });
  return { publicId: messagePublicId, sequence: sequenceRow.message_seq, deliveredAt: now };
}

export async function sendMessage(viewer: Viewer, roomPublicId: string, body: string, replyPublicId?: string | null) {
  const room = await requireRoom(viewer, roomPublicId, false);
  const cleanBody = body.trim();
  if (!cleanBody || cleanBody.length > 2000) throw new Error("INVALID_MESSAGE");
  let replyToId: string | null = null;
  if (replyPublicId) {
    const reply = await getDatabase().prepare("SELECT id FROM messages WHERE public_id = ? AND room_id = ? AND deleted_at IS NULL LIMIT 1")
      .bind(replyPublicId, room.id).first<{ id: string }>();
    if (!reply) throw new Error("INVALID_REPLY");
    replyToId = reply.id;
  }
  const bodyHash = await sha256(cleanBody.toLocaleLowerCase());
  const duplicate = await getDatabase().prepare(
    "SELECT COUNT(*) AS count FROM messages WHERE room_id = ? AND sender_id = ? AND body_hash = ? AND created_at > ?",
  ).bind(room.id, viewer.id, bodyHash, new Date(Date.now() - 45_000).toISOString()).first<{ count: number }>();
  if ((duplicate?.count ?? 0) >= 2) throw new Error("DUPLICATE_MESSAGE");
  return insertRoomMessage(room, viewer.id, "text", cleanBody, replyToId, bodyHash);
}

export async function markRead(viewer: Viewer, roomPublicId: string, sequence: number) {
  const room = await requireRoom(viewer, roomPublicId);
  await getDatabase().prepare("UPDATE room_members SET last_read_seq = CASE WHEN last_read_seq < ? THEN ? ELSE last_read_seq END WHERE room_id = ? AND user_id = ?")
    .bind(sequence, sequence, room.id, viewer.id).run();
  await publishRealtime(`room:${room.public_id}`, "receipt.updated", { roomPublicId, sequence });
}

export async function setTyping(viewer: Viewer, roomPublicId: string, typing: boolean) {
  const room = await requireRoom(viewer, roomPublicId, false);
  const until = typing ? new Date(Date.now() + 5_000).toISOString() : null;
  await getDatabase().prepare("UPDATE room_members SET typing_until = ? WHERE room_id = ? AND user_id = ?").bind(until, room.id, viewer.id).run();
  await publishRealtime(`room:${room.public_id}`, "typing.updated", { roomPublicId });
}

export async function dealIcebreaker(viewer: Viewer, roomPublicId: string, category: string) {
  const room = await requireRoom(viewer, roomPublicId, false);
  const question = selectIcebreaker(category);
  const result = await insertRoomMessage(room, null, "icebreaker", question, null, null);
  return { ...result, question };
}

export async function submitVibeCheck(viewer: Viewer, roomPublicId: string, choice: "vibing" | "not_yet") {
  const room = await requireRoom(viewer, roomPublicId, false);
  if (room.message_count < 6 && Date.now() - new Date(room.created_at).getTime() < 120_000) throw new Error("VIBE_CHECK_TOO_EARLY");
  const now = new Date().toISOString();
  await getDatabase().prepare(
    "INSERT INTO vibe_checks (id, room_id, result, created_at) VALUES (?, ?, 'pending', ?) ON CONFLICT(room_id) DO NOTHING",
  ).bind(randomId("vibe"), room.id, now).run();
  const column = viewer.id === room.user_a_id ? "user_a_choice" : "user_b_choice";
  await getDatabase().prepare(`UPDATE vibe_checks SET ${column} = ? WHERE room_id = ? AND result = 'pending'`).bind(choice, room.id).run();
  const check = await getDatabase().prepare("SELECT user_a_choice, user_b_choice, result FROM vibe_checks WHERE room_id = ?")
    .bind(room.id).first<{ user_a_choice: string | null; user_b_choice: string | null; result: string }>();
  if (!check) throw new Error("VIBE_CHECK_FAILED");
  if (check.user_a_choice && check.user_b_choice) {
    const result = check.user_a_choice === "vibing" && check.user_b_choice === "vibing" ? "mutual" : "not_yet";
    await getDatabase().batch([
      getDatabase().prepare("UPDATE vibe_checks SET result = ?, resolved_at = ? WHERE room_id = ? AND result = 'pending'").bind(result, now, room.id),
      ...(result === "mutual" ? [
        getDatabase().prepare("UPDATE room_members SET connection_level = 'vibe' WHERE room_id = ? AND connection_level IN ('stranger', 'familiar')").bind(room.id),
        getDatabase().prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, entity_public_id, created_at) VALUES (?, ?, ?, 'mutual_vibe', 'You two vibe', 'Ready to reveal a little more?', ?, ?)").bind(randomId("ntf"), publicId("note"), room.user_a_id, room.public_id, now),
        getDatabase().prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, entity_public_id, created_at) VALUES (?, ?, ?, 'mutual_vibe', 'You two vibe', 'Ready to reveal a little more?', ?, ?)").bind(randomId("ntf"), publicId("note"), room.user_b_id, room.public_id, now),
        getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'mutual_vibe', 'room', ?, '{}', ?)").bind(randomId("aud"), room.id, now),
      ] : []),
    ]);
    await publishRealtime(`room:${room.public_id}`, "vibe.resolved", { roomPublicId, result });
    return { status: result };
  }
  await publishRealtime(`room:${room.public_id}`, "vibe.pending", { roomPublicId });
  return { status: "pending" };
}

export async function voteIdentityReveal(viewer: Viewer, roomPublicId: string, layer: number, approve: boolean) {
  if (![1, 2, 3, 4].includes(layer)) throw new Error("INVALID_LAYER");
  const room = await requireRoom(viewer, roomPublicId, false);
  if (layer === 1) {
    const vibe = await getDatabase().prepare("SELECT result FROM vibe_checks WHERE room_id = ?").bind(room.id).first<{ result: string }>();
    if (vibe?.result !== "mutual") throw new Error("REVEAL_REQUIRES_MUTUAL_VIBE");
  } else {
    const previous = await getDatabase().prepare("SELECT status FROM identity_reveal_requests WHERE room_id = ? AND layer = ?")
      .bind(room.id, layer - 1).first<{ status: string }>();
    if (previous?.status !== "unlocked") throw new Error("REVEAL_OUT_OF_ORDER");
  }
  const now = new Date().toISOString();
  const isA = viewer.id === room.user_a_id;
  await getDatabase().prepare(
    "UPDATE identity_reveal_requests SET initiated_by_id = ?, user_a_approved = NULL, user_b_approved = NULL, status = 'pending', created_at = ?, resolved_at = NULL WHERE room_id = ? AND layer = ? AND status = 'dismissed'",
  ).bind(viewer.id, now, room.id, layer).run();
  await getDatabase().prepare(
    `INSERT INTO identity_reveal_requests (id, room_id, layer, initiated_by_id, user_a_approved, user_b_approved, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT(room_id, layer) DO NOTHING`,
  ).bind(randomId("reveal"), room.id, layer, viewer.id, isA ? (approve ? 1 : 0) : null, isA ? null : (approve ? 1 : 0), now).run();
  const column = isA ? "user_a_approved" : "user_b_approved";
  await getDatabase().prepare(`UPDATE identity_reveal_requests SET ${column} = ? WHERE room_id = ? AND layer = ? AND status = 'pending'`)
    .bind(approve ? 1 : 0, room.id, layer).run();
  const reveal = await getDatabase().prepare("SELECT user_a_approved, user_b_approved, status FROM identity_reveal_requests WHERE room_id = ? AND layer = ?")
    .bind(room.id, layer).first<{ user_a_approved: number | null; user_b_approved: number | null; status: string }>();
  if (!reveal) throw new Error("REVEAL_FAILED");
  let status = reveal.status;
  if (reveal.user_a_approved === 0 || reveal.user_b_approved === 0) status = "dismissed";
  else if (reveal.user_a_approved === 1 && reveal.user_b_approved === 1) status = "unlocked";
  if (status !== reveal.status) {
    await getDatabase().prepare("UPDATE identity_reveal_requests SET status = ?, resolved_at = ? WHERE room_id = ? AND layer = ? AND status = 'pending'")
      .bind(status, now, room.id, layer).run();
  }
  if (status === "unlocked") {
    await Promise.all([
      createNotification(room.user_a_id, "identity_unlock", "Identity unlocked", `Layer ${layer} is now open.`, room.public_id),
      createNotification(room.user_b_id, "identity_unlock", "Identity unlocked", `Layer ${layer} is now open.`, room.public_id),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'identity_layer_unlocked', 'room', ?, ?, ?)")
        .bind(randomId("aud"), viewer.id, room.id, JSON.stringify({ layer }), now).run(),
    ]);
  }
  await publishRealtime(`room:${room.public_id}`, "identity.updated", { roomPublicId, layer, status });
  return { status };
}

export async function setRetention(viewer: Viewer, roomPublicId: string, choice: RetentionChoice) {
  const room = await requireRoom(viewer, roomPublicId);
  await getDatabase().prepare("UPDATE room_members SET retention_choice = ? WHERE room_id = ? AND user_id = ?").bind(choice, room.id, viewer.id).run();
  return { choice };
}

async function rewardHealthyConversation(room: RoomAccess) {
  if (room.message_count < 8) return;
  const reported = await getDatabase().prepare("SELECT 1 AS found FROM reports WHERE room_id = ? LIMIT 1").bind(room.id).first();
  if (reported) return;
  for (const userId of [room.user_a_id, room.user_b_id]) {
    const user = await getDatabase().prepare("SELECT trust_score FROM users WHERE id = ?").bind(userId).first<{ trust_score: number }>();
    const score = Math.min(100, (user?.trust_score ?? 0) + 1);
    await getDatabase().batch([
      getDatabase().prepare("UPDATE users SET trust_score = ?, trust_band = ?, updated_at = ? WHERE id = ?").bind(score, trustBand(score), new Date().toISOString(), userId),
      getDatabase().prepare("INSERT INTO trust_events (id, user_id, event_type, score_delta, reference_id, created_at) VALUES (?, ?, 'healthy_conversation', 1, ?, ?)").bind(randomId("trust"), userId, room.id, new Date().toISOString()),
    ]);
  }
}

export async function endRoom(viewer: Viewer, roomPublicId: string, reason: "end" | "next" | "block" = "end") {
  const room = await requireRoom(viewer, roomPublicId, false);
  const now = new Date();
  const decision = reason === "block" ? { connect: false, expiresAt: now.toISOString() } : retentionDecision(room.mine_retention, room.partner_retention, now);
  const [userAId, userBId] = orderedPair(room.user_a_id, room.user_b_id);
  const statements = [
    getDatabase().prepare("UPDATE rooms SET status = 'ended', ended_by_id = ?, end_reason = ?, ended_at = ?, retention_until = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(viewer.id, reason, now.toISOString(), decision.expiresAt, now.toISOString(), room.id),
    getDatabase().prepare("DELETE FROM active_room_locks WHERE room_id = ?").bind(room.id),
    getDatabase().prepare("UPDATE room_members SET left_at = ? WHERE room_id = ? AND user_id = ?").bind(now.toISOString(), room.id, viewer.id),
    getDatabase().prepare("UPDATE presence SET status = 'online', updated_at = ? WHERE user_id IN (?, ?)").bind(now.toISOString(), room.user_a_id, room.user_b_id),
    getDatabase().prepare("UPDATE matchmaking_queue SET status = 'cancelled', updated_at = ? WHERE user_id IN (?, ?) AND status IN ('queued', 'claiming')").bind(now.toISOString(), room.user_a_id, room.user_b_id),
    getDatabase().prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, entity_public_id, created_at) VALUES (?, ?, ?, 'conversation_ended', 'Conversation ended', 'This conversation has ended.', ?, ?)").bind(randomId("ntf"), publicId("note"), room.partner_id, room.public_id, now.toISOString()),
    getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'conversation_ended', 'room', ?, ?, ?)").bind(randomId("aud"), viewer.id, room.id, JSON.stringify({ reason, retained: decision.expiresAt }), now.toISOString()),
  ];
  let connectionPublicId: string | null = null;
  if (decision.connect) {
    const existingConnection = await getDatabase().prepare(
      "SELECT public_id FROM connections WHERE user_a_id = ? AND user_b_id = ? LIMIT 1",
    ).bind(userAId, userBId).first<{ public_id: string }>();
    connectionPublicId = existingConnection?.public_id ?? publicId("connect");
    statements.push(
      getDatabase().prepare(
        `INSERT INTO connections (id, public_id, user_a_id, user_b_id, source_room_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET status = 'active', source_room_id = excluded.source_room_id, updated_at = excluded.updated_at`,
      ).bind(randomId("connection"), connectionPublicId, userAId, userBId, room.id, now.toISOString(), now.toISOString()),
      getDatabase().prepare("UPDATE room_members SET connection_level = 'connected' WHERE room_id = ?").bind(room.id),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'connection_created', 'connection', ?, '{}', ?)").bind(randomId("aud"), connectionPublicId, now.toISOString()),
    );
  }
  await getDatabase().batch(statements);
  await rewardHealthyConversation(room);
  if (decision.connect) {
    await Promise.all([
      createNotification(room.user_a_id, "connection", "Connected", "You both chose to keep this connection.", connectionPublicId),
      createNotification(room.user_b_id, "connection", "Connected", "You both chose to keep this connection.", connectionPublicId),
    ]);
  }
  await publishRealtime(`room:${room.public_id}`, "room.ended", { roomPublicId, reason: "ended" });
  return { ended: true, connectionPublicId, retentionUntil: decision.expiresAt };
}

export async function submitConversationFeedback(viewer: Viewer, roomPublicId: string, rating: "great" | "okay" | "skip") {
  const room = await requireRoom(viewer, roomPublicId);
  if (room.status !== "ended") throw new Error("FEEDBACK_AFTER_END_ONLY");
  const now = new Date().toISOString();
  await getDatabase().batch([
    getDatabase().prepare(
      `INSERT INTO conversation_feedback (room_id, user_id, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
    ).bind(room.id, viewer.id, rating, now, now),
    getDatabase().prepare(
      "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'conversation_feedback', 'room', ?, ?, ?)",
    ).bind(randomId("aud"), viewer.id, room.id, JSON.stringify({ rating }), now),
  ]);
  return { saved: true, rating };
}

export async function blockPartner(viewer: Viewer, roomPublicId: string, reason = "") {
  const room = await requireRoom(viewer, roomPublicId);
  const [userAId, userBId] = orderedPair(viewer.id, room.partner_id);
  const now = new Date().toISOString();
  await getDatabase().batch([
    getDatabase().prepare(
      "INSERT INTO blocks (id, blocker_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(blocker_id, blocked_id) DO NOTHING",
    ).bind(randomId("block"), viewer.id, room.partner_id, reason.slice(0, 200), now),
    getDatabase().prepare("UPDATE connections SET status = 'removed', updated_at = ? WHERE user_a_id = ? AND user_b_id = ?").bind(now, userAId, userBId),
    getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'user_blocked', 'user', ?, '{}', ?)").bind(randomId("aud"), viewer.id, room.partner_id, now),
  ]);
  if (room.status === "active") await endRoom(viewer, roomPublicId, "block");
  return { blocked: true };
}

export async function reportPartner(viewer: Viewer, roomPublicId: string, category: string, details: string, messagePublicId?: string | null) {
  if (!(REPORT_CATEGORIES as readonly string[]).includes(category)) throw new Error("INVALID_REPORT_CATEGORY");
  const room = await requireRoom(viewer, roomPublicId);
  let message: { id: string; public_id: string; body: string; created_at: string } | null = null;
  if (messagePublicId) {
    message = await getDatabase().prepare("SELECT id, public_id, body, created_at FROM messages WHERE public_id = ? AND room_id = ? LIMIT 1")
      .bind(messagePublicId, room.id).first<{ id: string; public_id: string; body: string; created_at: string }>();
    if (!message) throw new Error("MESSAGE_NOT_FOUND");
  }
  const reportId = randomId("report");
  const reportPublicId = publicId("report");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 180 * 86_400_000).toISOString();
  const priority = category === "threat" || category === "underage_concern" ? 10 : category === "sexual_content" || category === "hate" ? 5 : 0;
  const snapshot = JSON.stringify({ roomPublicId: room.public_id, message: message ? { publicId: message.public_id, body: message.body, createdAt: message.created_at } : null });
  await getDatabase().batch([
    getDatabase().prepare("INSERT INTO reports (id, public_id, reporter_id, reported_user_id, room_id, message_id, category, details, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)").bind(reportId, reportPublicId, viewer.id, room.partner_id, room.id, message?.id ?? null, category, details.trim().slice(0, 1000), priority, now.toISOString()),
    getDatabase().prepare("INSERT INTO report_evidence (id, report_id, evidence_type, snapshot, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(randomId("evidence"), reportId, message ? "message_snapshot" : "room_context", snapshot, now.toISOString(), expiresAt),
    getDatabase().prepare("INSERT INTO trust_events (id, user_id, event_type, score_delta, reference_id, created_at) VALUES (?, ?, 'report_received', 0, ?, ?)").bind(randomId("trust"), room.partner_id, reportId, now.toISOString()),
    getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'report_submitted', 'report', ?, ?, ?)").bind(randomId("aud"), viewer.id, reportId, JSON.stringify({ category, hasMessageEvidence: Boolean(message) }), now.toISOString()),
  ]);
  return { submitted: true, reportPublicId };
}

export async function requestSecondChance(viewer: Viewer, roomPublicId: string) {
  const room = await requireRoom(viewer, roomPublicId);
  if (room.status !== "ended" || room.end_reason !== "next" || !room.ended_at || Date.now() - new Date(room.ended_at).getTime() > 15 * 60_000) throw new Error("SECOND_CHANCE_UNAVAILABLE");
  const blocked = await getDatabase().prepare("SELECT 1 AS found FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1")
    .bind(viewer.id, room.partner_id, room.partner_id, viewer.id).first();
  if (blocked) throw new Error("SECOND_CHANCE_UNAVAILABLE");
  const reconnect = await getDatabase().prepare("SELECT reconnect_policy FROM preferences WHERE user_id = ?")
    .bind(room.partner_id).first<{ reconnect_policy: "allow" | "connections" | "nobody" }>();
  if (reconnect?.reconnect_policy === "nobody") throw new Error("SECOND_CHANCE_UNAVAILABLE");
  if (reconnect?.reconnect_policy === "connections") {
    const [userAId, userBId] = orderedPair(viewer.id, room.partner_id);
    const connection = await getDatabase().prepare("SELECT 1 AS found FROM connections WHERE user_a_id = ? AND user_b_id = ? AND status = 'active' LIMIT 1")
      .bind(userAId, userBId).first();
    if (!connection) throw new Error("SECOND_CHANCE_UNAVAILABLE");
  }
  const now = new Date();
  await getDatabase().prepare(
    "INSERT INTO second_chance_requests (id, room_id, requested_by_id, target_id, target_decision, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(room_id, requested_by_id) DO NOTHING",
  ).bind(randomId("second"), room.id, viewer.id, room.partner_id, now.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString()).run();
  await createNotification(room.partner_id, "second_chance", "Second Chance", "Someone wants to continue a recent conversation.", room.public_id);
  await publishRealtime(`user:${room.partner_public_id}`, "second_chance.requested", { roomPublicId: room.public_id });
  return { requested: true };
}

export async function respondSecondChance(viewer: Viewer, roomPublicId: string, accept: boolean) {
  const original = await requireRoom(viewer, roomPublicId);
  const request = await getDatabase().prepare(
    "SELECT id, requested_by_id, target_id FROM second_chance_requests WHERE room_id = ? AND target_id = ? AND target_decision = 'pending' AND expires_at > ? LIMIT 1",
  ).bind(original.id, viewer.id, new Date().toISOString()).first<{ id: string; requested_by_id: string; target_id: string }>();
  if (!request) throw new Error("SECOND_CHANCE_UNAVAILABLE");
  const now = new Date().toISOString();
  const claimed = await getDatabase().prepare("UPDATE second_chance_requests SET target_decision = ?, resolved_at = ? WHERE id = ? AND target_decision = 'pending'")
    .bind(accept ? "accepted" : "declined", now, request.id).run();
  if ((claimed.meta.changes ?? 0) !== 1 || !accept) return { accepted: false };
  if (await activeRoomForUser(viewer.id) || await activeRoomForUser(request.requested_by_id)) return { accepted: false };
  const requester = await getDatabase().prepare("SELECT u.public_id, p.alias FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? AND u.status = 'active'")
    .bind(request.requested_by_id).first<{ public_id: string; alias: string }>();
  if (!requester) return { accepted: false };
  const [userAId, userBId] = orderedPair(viewer.id, request.requested_by_id);
  const roomId = randomId("room");
  const newPublicId = publicId("room");
  try {
    await getDatabase().batch([
      getDatabase().prepare("INSERT INTO rooms (id, public_id, user_a_id, user_b_id, status, match_mode, vibe_score, message_seq, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'second_chance', 0, 0, 0, ?, ?)").bind(roomId, newPublicId, userAId, userBId, now, now),
      getDatabase().prepare("INSERT INTO matches (id, user_a_id, user_b_id, room_id, match_mode, vibe_score, created_at) VALUES (?, ?, ?, ?, 'second_chance', 0, ?)").bind(randomId("match"), userAId, userBId, roomId, now),
      getDatabase().prepare("INSERT INTO room_members (room_id, user_id, anonymous_alias, connection_level, retention_choice, last_read_seq, joined_at) VALUES (?, ?, ?, 'familiar', 'chat', 0, ?)").bind(roomId, viewer.id, viewer.alias, now),
      getDatabase().prepare("INSERT INTO room_members (room_id, user_id, anonymous_alias, connection_level, retention_choice, last_read_seq, joined_at) VALUES (?, ?, ?, 'familiar', 'chat', 0, ?)").bind(roomId, request.requested_by_id, requester.alias, now),
      getDatabase().prepare("INSERT INTO active_room_locks (user_id, room_id, created_at) VALUES (?, ?, ?)").bind(viewer.id, roomId, now),
      getDatabase().prepare("INSERT INTO active_room_locks (user_id, room_id, created_at) VALUES (?, ?, ?)").bind(request.requested_by_id, roomId, now),
      getDatabase().prepare("UPDATE presence SET status = 'chatting', updated_at = ? WHERE user_id IN (?, ?)").bind(now, viewer.id, request.requested_by_id),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'conversation_started', 'room', ?, ?, ?)").bind(randomId("aud"), roomId, JSON.stringify({ mode: "second_chance" }), now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("duplicate key")) return { accepted: false };
    throw error;
  }
  await Promise.allSettled([
    publishRealtime(`user:${viewer.public_id}`, "match.found", { roomPublicId: newPublicId }),
    publishRealtime(`user:${requester.public_id}`, "match.found", { roomPublicId: newPublicId }),
  ]);
  return { accepted: true, roomPublicId: newPublicId };
}

export async function removeConnection(viewer: Viewer, connectionPublicId: string) {
  await getDatabase().prepare("UPDATE connections SET status = 'removed', updated_at = ? WHERE public_id = ? AND (user_a_id = ? OR user_b_id = ?)")
    .bind(new Date().toISOString(), connectionPublicId, viewer.id, viewer.id).run();
  return { removed: true };
}

export async function openConnection(viewer: Viewer, connectionPublicId: string) {
  const active = await activeRoomForUser(viewer.id);
  if (active) return { roomPublicId: active.public_id, existing: true };
  const connection = await getDatabase().prepare(
    `SELECT c.id, c.user_a_id, c.user_b_id,
      other.id AS partner_id, other.public_id AS partner_public_id, p.alias AS partner_alias
     FROM connections c
     JOIN users other ON other.id = CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END
     JOIN profiles p ON p.user_id = other.id
     WHERE c.public_id = ? AND c.status = 'active' AND (c.user_a_id = ? OR c.user_b_id = ?) LIMIT 1`,
  ).bind(viewer.id, connectionPublicId, viewer.id, viewer.id).first<{ id: string; user_a_id: string; user_b_id: string; partner_id: string; partner_public_id: string; partner_alias: string }>();
  if (!connection || await activeRoomForUser(connection.partner_id)) throw new Error("CONNECTION_UNAVAILABLE");
  const blocked = await getDatabase().prepare("SELECT 1 AS found FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1")
    .bind(viewer.id, connection.partner_id, connection.partner_id, viewer.id).first();
  if (blocked) throw new Error("CONNECTION_UNAVAILABLE");
  const [userAId, userBId] = orderedPair(viewer.id, connection.partner_id);
  const id = randomId("room");
  const roomPublicId = publicId("room");
  const now = new Date().toISOString();
  try {
    await getDatabase().batch([
      getDatabase().prepare("INSERT INTO rooms (id, public_id, user_a_id, user_b_id, status, match_mode, vibe_score, message_seq, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'connection', 0, 0, 0, ?, ?)").bind(id, roomPublicId, userAId, userBId, now, now),
      getDatabase().prepare("INSERT INTO matches (id, user_a_id, user_b_id, room_id, match_mode, vibe_score, created_at) VALUES (?, ?, ?, ?, 'connection', 0, ?)").bind(randomId("match"), userAId, userBId, id, now),
      getDatabase().prepare("INSERT INTO room_members (room_id, user_id, anonymous_alias, connection_level, retention_choice, last_read_seq, joined_at) VALUES (?, ?, ?, 'connected', 'keep', 0, ?)").bind(id, viewer.id, viewer.alias, now),
      getDatabase().prepare("INSERT INTO room_members (room_id, user_id, anonymous_alias, connection_level, retention_choice, last_read_seq, joined_at) VALUES (?, ?, ?, 'connected', 'keep', 0, ?)").bind(id, connection.partner_id, connection.partner_alias, now),
      getDatabase().prepare("INSERT INTO active_room_locks (user_id, room_id, created_at) VALUES (?, ?, ?)").bind(viewer.id, id, now),
      getDatabase().prepare("INSERT INTO active_room_locks (user_id, room_id, created_at) VALUES (?, ?, ?)").bind(connection.partner_id, id, now),
      getDatabase().prepare("UPDATE presence SET status = 'chatting', updated_at = ? WHERE user_id IN (?, ?)").bind(now, viewer.id, connection.partner_id),
      getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'conversation_started', 'room', ?, ?, ?)").bind(randomId("aud"), id, JSON.stringify({ mode: "connection" }), now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("unique") && !message.includes("duplicate key")) throw error;
    const existing = await activeRoomForUser(viewer.id);
    if (existing) return { roomPublicId: existing.public_id, existing: true };
    throw new Error("CONNECTION_UNAVAILABLE");
  }
  await Promise.allSettled([
    publishRealtime(`user:${viewer.public_id}`, "match.found", { roomPublicId }),
    publishRealtime(`user:${connection.partner_public_id}`, "match.found", { roomPublicId }),
  ]);
  return { roomPublicId, existing: false };
}
