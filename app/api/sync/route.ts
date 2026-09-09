import { getMessages, hydrateRoom } from "@/lib/rooms";
import { consumeRateLimit, getViewer, jsonError } from "@/lib/server-foundation";

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(request: Request) {
  try {
    const viewer = await getViewer(request);
    if (!viewer) throw new Error("AUTH_REQUIRED");
    const url = new URL(request.url);
    const roomPublicId = (url.searchParams.get("room") ?? "").slice(0, 80);
    const before = Number.parseInt(url.searchParams.get("before") ?? "0", 10);
    const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
    const paginate = before > 0;
    if (!roomPublicId) return Response.json({ error: "Room diperlukan." }, { status: 400 });
    if (!(await consumeRateLimit(request, paginate ? "message_history" : "room_sync", paginate ? 80 : 240, 600, viewer.id))) {
      return Response.json({ error: "Sinkronisasi terlalu sering. Tunggu sebentar." }, { status: 429 });
    }
    if (paginate) {
      const messages = await getMessages(viewer, roomPublicId, { before, limit: 40 });
      return Response.json({ messages, hasMore: messages.length === 40 }, { headers: { "cache-control": "no-store" } });
    }

    const intervals = [0, 2_000, 4_000];
    let messages: Awaited<ReturnType<typeof getMessages>> = [];
    let room: Awaited<ReturnType<typeof hydrateRoom>> | null = null;
    for (const interval of intervals) {
      if (interval) await wait(interval);
      messages = await getMessages(viewer, roomPublicId, { after: Math.max(0, after), limit: 60 });
      room = await hydrateRoom(viewer, roomPublicId);
      if (messages.length || room.status !== "active" || room.latestSequence > after) break;
    }
    return Response.json({ messages, room }, { headers: { "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (error) {
    return jsonError(error);
  }
}
