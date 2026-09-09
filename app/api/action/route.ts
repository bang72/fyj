import { z } from "zod";

import { sanitizeVibes } from "@/lib/mivo-core";
import { attemptMatch, cancelSearch, expandSearch, startSearch } from "@/lib/matchmaking";
import {
  blockPartner,
  dealIcebreaker,
  endRoom,
  markRead,
  openConnection,
  removeConnection,
  reportPartner,
  requestSecondChance,
  respondSecondChance,
  sendMessage,
  setRetention,
  setTyping,
  submitVibeCheck,
  submitConversationFeedback,
  voteIdentityReveal,
} from "@/lib/rooms";
import { assertSameOrigin, consumeRateLimit, jsonError, requireViewer } from "@/lib/server-foundation";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("presence"), state: z.enum(["online", "searching", "chatting", "away"]), connectionId: z.string().max(80).optional() }),
  z.object({ action: z.literal("match.start"), desiredGender: z.enum(["random", "woman", "man"]), vibes: z.array(z.string()).max(10), expanded: z.boolean().optional() }),
  z.object({ action: z.literal("match.status") }),
  z.object({ action: z.literal("match.cancel") }),
  z.object({ action: z.literal("match.expand") }),
  z.object({ action: z.literal("message.send"), roomPublicId: z.string().max(80), body: z.string().max(2000), replyPublicId: z.string().max(80).nullable().optional() }),
  z.object({ action: z.literal("message.read"), roomPublicId: z.string().max(80), sequence: z.number().int().nonnegative() }),
  z.object({ action: z.literal("typing"), roomPublicId: z.string().max(80), typing: z.boolean() }),
  z.object({ action: z.literal("icebreaker"), roomPublicId: z.string().max(80), category: z.enum(["Funny", "Random", "Deep", "Dreams", "Music", "Gaming", "Life"]) }),
  z.object({ action: z.literal("vibe.check"), roomPublicId: z.string().max(80), choice: z.enum(["vibing", "not_yet"]) }),
  z.object({ action: z.literal("identity.vote"), roomPublicId: z.string().max(80), layer: z.number().int().min(1).max(4), approve: z.boolean() }),
  z.object({ action: z.literal("retention"), roomPublicId: z.string().max(80), choice: z.enum(["chat", "24h", "7d", "keep"]) }),
  z.object({ action: z.literal("room.end"), roomPublicId: z.string().max(80) }),
  z.object({ action: z.literal("room.feedback"), roomPublicId: z.string().max(80), rating: z.enum(["great", "okay", "skip"]) }),
  z.object({ action: z.literal("room.next"), roomPublicId: z.string().max(80), desiredGender: z.enum(["random", "woman", "man"]), vibes: z.array(z.string()).max(10) }),
  z.object({ action: z.literal("room.block"), roomPublicId: z.string().max(80), reason: z.string().max(200).optional() }),
  z.object({ action: z.literal("room.report"), roomPublicId: z.string().max(80), category: z.string().max(40), details: z.string().max(1000), messagePublicId: z.string().max(80).nullable().optional() }),
  z.object({ action: z.literal("second_chance.request"), roomPublicId: z.string().max(80) }),
  z.object({ action: z.literal("second_chance.respond"), roomPublicId: z.string().max(80), accept: z.boolean() }),
  z.object({ action: z.literal("connection.remove"), connectionPublicId: z.string().max(80) }),
  z.object({ action: z.literal("connection.open"), connectionPublicId: z.string().max(80) }),
]);

const ACTION_ERRORS: Record<string, [string, number]> = {
    ROOM_NOT_FOUND: ["Percakapan itu tidak tersedia.", 404],
    ROOM_ENDED: ["Conversation ended.", 409],
    INVALID_MESSAGE: ["Tulis pesan antara 1–2.000 karakter.", 400],
    INVALID_REPLY: ["Pesan yang ingin dibalas tidak tersedia.", 400],
    DUPLICATE_MESSAGE: ["Pesan yang sama dikirim berulang. Tunggu sebentar.", 429],
    VIBE_CHECK_TOO_EARLY: ["Ngobrol sedikit lagi sebelum Vibe Check.", 409],
    REVEAL_REQUIRES_MUTUAL_VIBE: ["Identity Layers terbuka setelah kalian sama-sama memilih VIBING.", 409],
    REVEAL_OUT_OF_ORDER: ["Buka layer sebelumnya lebih dulu.", 409],
    SECOND_CHANCE_UNAVAILABLE: ["Second Chance sudah tidak tersedia untuk percakapan ini.", 409],
    INVALID_REPORT_CATEGORY: ["Pilih alasan laporan yang tersedia.", 400],
    CONNECTION_UNAVAILABLE: ["Connection itu sedang tidak tersedia.", 409],
    FEEDBACK_AFTER_END_ONLY: ["Feedback tersedia setelah percakapan berakhir.", 409],
    STAFF_MATCH_DISABLED: ["Akun staff tidak ikut anonymous matchmaking. Gunakan akun USER terpisah untuk pengujian chat.", 403],
  };

function actionError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known = ACTION_ERRORS[code];
  return known ? Response.json({ error: known[0], code }, { status: known[1] }) : jsonError(error);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Aksi itu belum valid." }, { status: 400 });
    const body = parsed.data;

    if (body.action === "presence") {
      if (!(await consumeRateLimit(request, "presence", 90, 600, viewer.id))) return Response.json({ error: "Presence terlalu sering diperbarui." }, { status: 429 });
      const now = new Date().toISOString();
      const freshCutoff = new Date(Date.now() - 45_000).toISOString();
      const { getDatabase } = await import("@/lib/database");
      await getDatabase().prepare(`INSERT INTO presence (user_id, status, connection_id, last_heartbeat_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          status = CASE WHEN excluded.status = 'away' AND presence.connection_id != excluded.connection_id AND presence.last_heartbeat_at > ? AND presence.status != 'away' THEN presence.status ELSE excluded.status END,
          connection_id = CASE WHEN excluded.status = 'away' AND presence.connection_id != excluded.connection_id AND presence.last_heartbeat_at > ? AND presence.status != 'away' THEN presence.connection_id ELSE excluded.connection_id END,
          last_heartbeat_at = CASE WHEN excluded.status = 'away' AND presence.connection_id != excluded.connection_id AND presence.last_heartbeat_at > ? AND presence.status != 'away' THEN presence.last_heartbeat_at ELSE excluded.last_heartbeat_at END,
          updated_at = CASE WHEN excluded.status = 'away' AND presence.connection_id != excluded.connection_id AND presence.last_heartbeat_at > ? AND presence.status != 'away' THEN presence.updated_at ELSE excluded.updated_at END`)
        .bind(viewer.id, body.state, body.connectionId ?? null, now, now, freshCutoff, freshCutoff, freshCutoff, freshCutoff).run();
      return Response.json({ ok: true });
    }
    if (body.action === "match.start") {
      if (!(await consumeRateLimit(request, "match_start", 20, 600, viewer.id))) return Response.json({ error: "Kamu terlalu cepat mengulang pencarian. Istirahat sebentar.", code: "MATCH_COOLDOWN" }, { status: 429 });
      const vibes = sanitizeVibes(body.vibes);
      if (!vibes.length) return Response.json({ error: "Pilih setidaknya satu vibe." }, { status: 400 });
      return Response.json(await startSearch(viewer, body.desiredGender, vibes, body.expanded));
    }
    if (body.action === "match.status") {
      if (!(await consumeRateLimit(request, "match_status", 150, 600, viewer.id))) return Response.json({ error: "Pemeriksaan pencarian terlalu sering. Tunggu sebentar." }, { status: 429 });
      return Response.json(await attemptMatch(viewer));
    }
    if (body.action === "match.cancel") return Response.json(await cancelSearch(viewer));
    if (body.action === "match.expand") return Response.json(await expandSearch(viewer));
    if (body.action === "message.send") {
      if (!(await consumeRateLimit(request, "message", 40, 60, viewer.id))) return Response.json({ error: "Kamu mengirim pesan terlalu cepat. Tunggu sebentar." }, { status: 429 });
      return Response.json(await sendMessage(viewer, body.roomPublicId, body.body, body.replyPublicId), { status: 201 });
    }
    if (body.action === "message.read") {
      await markRead(viewer, body.roomPublicId, body.sequence);
      return Response.json({ ok: true });
    }
    if (body.action === "typing") {
      if (!(await consumeRateLimit(request, "typing", 180, 60, viewer.id))) return Response.json({ error: "Typing update terlalu sering." }, { status: 429 });
      await setTyping(viewer, body.roomPublicId, body.typing);
      return Response.json({ ok: true });
    }
    if (body.action === "icebreaker") {
      if (!(await consumeRateLimit(request, "icebreaker", 12, 3600, viewer.id))) return Response.json({ error: "Cukup dulu untuk icebreaker. Lanjutkan obrolan kalian." }, { status: 429 });
      return Response.json(await dealIcebreaker(viewer, body.roomPublicId, body.category));
    }
    if (body.action === "vibe.check") return Response.json(await submitVibeCheck(viewer, body.roomPublicId, body.choice));
    if (body.action === "identity.vote") return Response.json(await voteIdentityReveal(viewer, body.roomPublicId, body.layer, body.approve));
    if (body.action === "retention") return Response.json(await setRetention(viewer, body.roomPublicId, body.choice));
    if (body.action === "room.end") return Response.json(await endRoom(viewer, body.roomPublicId, "end"));
    if (body.action === "room.feedback") return Response.json(await submitConversationFeedback(viewer, body.roomPublicId, body.rating));
    if (body.action === "room.next") {
      if (!(await consumeRateLimit(request, "next", 30, 3600, viewer.id))) return Response.json({ error: "Terlalu banyak percakapan diakhiri dalam waktu singkat. Coba lagi nanti." }, { status: 429 });
      await endRoom(viewer, body.roomPublicId, "next");
      const vibes = sanitizeVibes(body.vibes);
      return Response.json(await startSearch(viewer, body.desiredGender, vibes.length ? vibes : ["random"]));
    }
    if (body.action === "room.block") return Response.json(await blockPartner(viewer, body.roomPublicId, body.reason));
    if (body.action === "room.report") {
      if (!(await consumeRateLimit(request, "report", 12, 86_400, viewer.id))) return Response.json({ error: "Batas laporan hari ini tercapai. Hubungi bantuan jika ada bahaya langsung." }, { status: 429 });
      return Response.json(await reportPartner(viewer, body.roomPublicId, body.category, body.details, body.messagePublicId), { status: 201 });
    }
    if (body.action === "second_chance.request") return Response.json(await requestSecondChance(viewer, body.roomPublicId));
    if (body.action === "second_chance.respond") return Response.json(await respondSecondChance(viewer, body.roomPublicId, body.accept));
    if (body.action === "connection.remove") return Response.json(await removeConnection(viewer, body.connectionPublicId));
    if (body.action === "connection.open") return Response.json(await openConnection(viewer, body.connectionPublicId));
    return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (!ACTION_ERRORS[code] && !["AUTH_REQUIRED", "ACCOUNT_SUSPENDED", "CSRF_REJECTED"].includes(code)) console.error("action_failed", error);
    return actionError(error);
  }
}
