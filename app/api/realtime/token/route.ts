import { activeRoomForUser } from "@/lib/matchmaking";
import { createRealtimeJwt } from "@/lib/realtime";
import { getViewer, jsonError } from "@/lib/server-foundation";

export async function GET(request: Request) {
  try {
    const viewer = await getViewer(request);
    if (!viewer) throw new Error("AUTH_REQUIRED");
    const room = await activeRoomForUser(viewer.id);
    const channels = [`user:${viewer.public_id}`];
    if (room) channels.push(`room:${room.public_id}`);
    const token = await createRealtimeJwt(viewer.public_id, channels);
    return new Response(token, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
