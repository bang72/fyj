
import { getDatabase } from "@/lib/database";
import {
  canUseGenderFilter,
  entitlementDate,
  orderedPair,
  overlapScore,
  publicId,
  randomId,
  safeJsonArray,
  type Plan,
} from "@/lib/mivo-core";
import { getPlan, runtimeValue, type Viewer } from "@/lib/server-foundation";
import { publishRealtime } from "@/lib/realtime";

type QueueRow = {
  id: string;
  user_id: string;
  desired_gender: "random" | "woman" | "man";
  vibes_json: string;
  expanded: number;
  status: string;
  created_at: string;
};

type CandidateRow = QueueRow & {
  gender: "woman" | "man" | "nonbinary" | "private";
  alias: string;
  public_id: string;
  candidate_created_at: string;
};

export async function activeRoomForUser(userId: string) {
  return getDatabase().prepare(
    "SELECT id, public_id, status FROM rooms WHERE status = 'active' AND (user_a_id = ? OR user_b_id = ?) ORDER BY created_at DESC LIMIT 1",
  ).bind(userId, userId).first<{ id: string; public_id: string; status: string }>();
}

async function dailyUsage(userId: string) {
  const date = entitlementDate(new Date(), runtimeValue("APP_TIMEZONE") ?? "Asia/Jakarta");
  const row = await getDatabase().prepare(
    "SELECT filtered_matches_used FROM daily_entitlements WHERE user_id = ? AND entitlement_date = ?",
  ).bind(userId, date).first<{ filtered_matches_used: number }>();
  return { date, used: row?.filtered_matches_used ?? 0 };
}

export async function entitlementForUser(userId: string) {
  const subscription = await getPlan(userId);
  const usage = await dailyUsage(userId);
  const filter = canUseGenderFilter(subscription.plan as Plan, usage.used);
  return { ...subscription, used: usage.used, date: usage.date, genderFilter: filter };
}

function genderCompatible(searcherGender: string, desired: string, candidateGender: string, candidateDesired: string) {
  const searcherAccepts = desired === "random" || desired === candidateGender;
  const candidateAccepts = candidateDesired === "random" || candidateDesired === searcherGender;
  return searcherAccepts && candidateAccepts;
}

async function candidateEntitled(candidate: CandidateRow) {
  if (candidate.desired_gender === "random") return true;
  const entitlement = await entitlementForUser(candidate.user_id);
  return entitlement.genderFilter.allowed;
}

export async function attemptMatch(viewer: Viewer) {
  const database = getDatabase();
  const own = await database.prepare("SELECT * FROM matchmaking_queue WHERE user_id = ? AND status = 'queued' LIMIT 1")
    .bind(viewer.id).first<QueueRow>();
  if (!own) {
    const room = await activeRoomForUser(viewer.id);
    return room ? { state: "matched" as const, roomPublicId: room.public_id } : { state: "idle" as const };
  }

  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const recentCutoff = new Date(Date.now() - (own.expanded ? 15 * 60_000 : 24 * 60 * 60_000)).toISOString();
  const skippedPairCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const candidates = await database.prepare(
    `SELECT q.*, i.gender, p.alias, u.public_id, q.created_at AS candidate_created_at
     FROM matchmaking_queue q
     JOIN users u ON u.id = q.user_id
     JOIN identities i ON i.user_id = q.user_id
     JOIN profiles p ON p.user_id = q.user_id
     JOIN presence pr ON pr.user_id = q.user_id
     WHERE q.status = 'queued' AND q.user_id != ? AND q.expires_at > ?
       AND u.status = 'active' AND u.role = 'USER' AND pr.last_heartbeat_at > ?
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = ? AND b.blocked_id = q.user_id)
            OR (b.blocker_id = q.user_id AND b.blocked_id = ?)
       )
       AND NOT EXISTS (
         SELECT 1 FROM rooms active
         WHERE active.status = 'active' AND (active.user_a_id = q.user_id OR active.user_b_id = q.user_id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM matches m
         WHERE m.created_at > ?
           AND ((m.user_a_id = ? AND m.user_b_id = q.user_id) OR (m.user_b_id = ? AND m.user_a_id = q.user_id))
       )
       AND NOT EXISTS (
         SELECT 1 FROM conversation_feedback cf
         JOIN rooms feedback_room ON feedback_room.id = cf.room_id
         WHERE cf.rating = 'skip' AND cf.created_at > ?
           AND ((feedback_room.user_a_id = ? AND feedback_room.user_b_id = q.user_id)
             OR (feedback_room.user_b_id = ? AND feedback_room.user_a_id = q.user_id))
       )
     ORDER BY q.created_at ASC LIMIT 60`,
  ).bind(viewer.id, new Date().toISOString(), cutoff, viewer.id, viewer.id, recentCutoff, viewer.id, viewer.id, skippedPairCutoff, viewer.id, viewer.id).all<CandidateRow>();

  const ownVibes = safeJsonArray(own.vibes_json);
  const ranked: Array<{ candidate: CandidateRow; score: number }> = [];
  for (const candidate of candidates.results) {
    if (!genderCompatible(viewer.gender, own.desired_gender, candidate.gender, candidate.desired_gender)) continue;
    const score = overlapScore(ownVibes, safeJsonArray(candidate.vibes_json));
    if (!own.expanded && !candidate.expanded && score === 0) continue;
    if (!(await candidateEntitled(candidate))) continue;
    ranked.push({ candidate, score });
  }
  ranked.sort((left, right) => right.score - left.score || left.candidate.candidate_created_at.localeCompare(right.candidate.candidate_created_at));

  for (const { candidate, score } of ranked) {
    const claimToken = randomId("claim");
    const claimedAt = new Date().toISOString();
    const claims = await database.batch([
      database.prepare("UPDATE matchmaking_queue SET status = 'claiming', claim_token = ?, claimed_at = ?, updated_at = ? WHERE user_id = ? AND status = 'queued'").bind(claimToken, claimedAt, claimedAt, viewer.id),
      database.prepare("UPDATE matchmaking_queue SET status = 'claiming', claim_token = ?, claimed_at = ?, updated_at = ? WHERE user_id = ? AND status = 'queued'").bind(claimToken, claimedAt, claimedAt, candidate.user_id),
    ]);
    if ((claims[0]?.meta.changes ?? 0) !== 1 || (claims[1]?.meta.changes ?? 0) !== 1) {
      await database.prepare("UPDATE matchmaking_queue SET status = 'queued', claim_token = NULL, claimed_at = NULL, updated_at = ? WHERE claim_token = ? AND status = 'claiming'").bind(new Date().toISOString(), claimToken).run();
      continue;
    }

    const requesterEntitlement = own.desired_gender === "random" ? null : await entitlementForUser(viewer.id);
    const partnerEntitlement = candidate.desired_gender === "random" ? null : await entitlementForUser(candidate.user_id);
    if ((requesterEntitlement && !requesterEntitlement.genderFilter.allowed) || (partnerEntitlement && !partnerEntitlement.genderFilter.allowed)) {
      await database.prepare("UPDATE matchmaking_queue SET status = 'queued', claim_token = NULL, claimed_at = NULL, updated_at = ? WHERE claim_token = ?").bind(new Date().toISOString(), claimToken).run();
      continue;
    }

    const [userAId, userBId] = orderedPair(viewer.id, candidate.user_id);
    const roomId = randomId("room");
    const roomPublicId = publicId("room");
    const matchId = randomId("match");
    const mode = own.desired_gender !== "random" || candidate.desired_gender !== "random" ? "filtered" : "random";
    const now = new Date().toISOString();
    const viewerAlias = viewer.alias;
    const candidateAlias = candidate.alias;
    const matchStatements = [
      database.prepare("INSERT INTO rooms (id, public_id, user_a_id, user_b_id, status, match_mode, vibe_score, message_seq, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, 0, 0, ?, ?)").bind(roomId, roomPublicId, userAId, userBId, mode, score, now, now),
      database.prepare("INSERT INTO matches (id, user_a_id, user_b_id, room_id, match_mode, vibe_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(matchId, userAId, userBId, roomId, mode, score, now),
      database.prepare("INSERT INTO room_members (room_id, user_id, anonymous_alias, connection_level, retention_choice, last_read_seq, joined_at) VALUES (?, ?, ?, 'stranger', 'chat', 0, ?)").bind(roomId, viewer.id, viewerAlias, now),
      database.prepare("INSERT INTO room_members (room_id, user_id, anonymous_alias, connection_level, retention_choice, last_read_seq, joined_at) VALUES (?, ?, ?, 'stranger', 'chat', 0, ?)").bind(roomId, candidate.user_id, candidateAlias, now),
      database.prepare("INSERT INTO active_room_locks (user_id, room_id, created_at) VALUES (?, ?, ?)").bind(viewer.id, roomId, now),
      database.prepare("INSERT INTO active_room_locks (user_id, room_id, created_at) VALUES (?, ?, ?)").bind(candidate.user_id, roomId, now),
      database.prepare("UPDATE matchmaking_queue SET status = 'matched', updated_at = ? WHERE claim_token = ? AND status = 'claiming'").bind(now, claimToken),
      database.prepare("UPDATE presence SET status = 'chatting', updated_at = ? WHERE user_id IN (?, ?)").bind(now, viewer.id, candidate.user_id),
      database.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, entity_public_id, created_at) VALUES (?, ?, ?, 'match_found', 'Match found', 'Someone is ready to vibe.', ?, ?)").bind(randomId("ntf"), publicId("note"), viewer.id, roomPublicId, now),
      database.prepare("INSERT INTO notifications (id, public_id, user_id, type, title, body, entity_public_id, created_at) VALUES (?, ?, ?, 'match_found', 'Match found', 'Someone is ready to vibe.', ?, ?)").bind(randomId("ntf"), publicId("note"), candidate.user_id, roomPublicId, now),
      database.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'match_found', 'room', ?, ?, ?)").bind(randomId("aud"), roomId, JSON.stringify({ mode, overlap: score }), now),
      database.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, NULL, 'conversation_started', 'room', ?, ?, ?)").bind(randomId("aud"), roomId, JSON.stringify({ mode }), now),
    ];
    if (requesterEntitlement) {
      matchStatements.push(database.prepare(
        "INSERT INTO daily_entitlements (user_id, entitlement_date, filtered_matches_used, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, entitlement_date) DO UPDATE SET filtered_matches_used = daily_entitlements.filtered_matches_used + 1, updated_at = excluded.updated_at",
      ).bind(viewer.id, requesterEntitlement.date, now));
    }
    if (partnerEntitlement) {
      matchStatements.push(database.prepare(
        "INSERT INTO daily_entitlements (user_id, entitlement_date, filtered_matches_used, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, entitlement_date) DO UPDATE SET filtered_matches_used = daily_entitlements.filtered_matches_used + 1, updated_at = excluded.updated_at",
      ).bind(candidate.user_id, partnerEntitlement.date, now));
    }
    try {
      await database.batch(matchStatements);
    } catch (error) {
      await database.prepare("UPDATE matchmaking_queue SET status = 'queued', claim_token = NULL, claimed_at = NULL, updated_at = ? WHERE claim_token = ? AND status = 'claiming'").bind(new Date().toISOString(), claimToken).run();
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unique") || message.includes("duplicate key")) {
        const active = await activeRoomForUser(viewer.id);
        if (active) return { state: "matched" as const, roomPublicId: active.public_id };
        continue;
      }
      throw error;
    }
    await Promise.allSettled([
      publishRealtime(`user:${viewer.public_id}`, "match.found", { roomPublicId }),
      publishRealtime(`user:${candidate.public_id}`, "match.found", { roomPublicId }),
    ]);
    return { state: "matched" as const, roomPublicId };
  }
  return { state: "queued" as const, since: own.created_at, expanded: Boolean(own.expanded) };
}

export async function startSearch(viewer: Viewer, desiredGender: "random" | "woman" | "man", vibes: string[], expanded = false) {
  if (viewer.role !== "USER") throw new Error("STAFF_MATCH_DISABLED");
  const active = await activeRoomForUser(viewer.id);
  if (active) return { state: "matched" as const, roomPublicId: active.public_id };
  if (desiredGender !== "random") {
    const entitlement = await entitlementForUser(viewer.id);
    if (!entitlement.genderFilter.allowed) {
      const code = entitlement.plan === "FREE" ? "SUBSCRIPTION_REQUIRED" : "FILTER_QUOTA_REACHED";
      return { state: "blocked" as const, code, entitlement };
    }
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const queueId = randomId("queue");
  await getDatabase().batch([
    getDatabase().prepare(
      `INSERT INTO matchmaking_queue (id, user_id, desired_gender, vibes_json, expanded, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET desired_gender = excluded.desired_gender, vibes_json = excluded.vibes_json,
       expanded = excluded.expanded, status = 'queued', claim_token = NULL, claimed_at = NULL,
       created_at = excluded.created_at, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
    ).bind(queueId, viewer.id, desiredGender, JSON.stringify(vibes), expanded ? 1 : 0, now.toISOString(), now.toISOString(), expiresAt),
    getDatabase().prepare("INSERT INTO presence (user_id, status, last_heartbeat_at, updated_at) VALUES (?, 'searching', ?, ?) ON CONFLICT(user_id) DO UPDATE SET status = 'searching', last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at").bind(viewer.id, now.toISOString(), now.toISOString()),
    getDatabase().prepare("UPDATE preferences SET desired_gender = ?, updated_at = ? WHERE user_id = ?").bind(desiredGender, now.toISOString(), viewer.id),
    getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'match_search_started', 'queue', ?, ?, ?)").bind(randomId("aud"), viewer.id, queueId, JSON.stringify({ desiredGender, vibeCount: vibes.length, expanded }), now.toISOString()),
  ]);
  return attemptMatch(viewer);
}

export async function cancelSearch(viewer: Viewer) {
  const now = new Date().toISOString();
  await getDatabase().batch([
    getDatabase().prepare("UPDATE matchmaking_queue SET status = 'cancelled', claim_token = NULL, claimed_at = NULL, updated_at = ? WHERE user_id = ? AND status IN ('queued', 'claiming')").bind(now, viewer.id),
    getDatabase().prepare("UPDATE presence SET status = 'online', updated_at = ? WHERE user_id = ?").bind(now, viewer.id),
    getDatabase().prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'match_cancelled', 'queue', NULL, '{}', ?)").bind(randomId("aud"), viewer.id, now),
  ]);
  return { state: "idle" as const };
}

export async function expandSearch(viewer: Viewer) {
  await getDatabase().prepare("UPDATE matchmaking_queue SET expanded = 1, updated_at = ? WHERE user_id = ? AND status = 'queued'")
    .bind(new Date().toISOString(), viewer.id).run();
  return attemptMatch(viewer);
}
