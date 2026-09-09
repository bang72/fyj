import { assertSameOrigin, expiredSessionCookie, jsonError, revokeSession } from "@/lib/server-foundation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeSession(request);
    return Response.json({ ok: true }, { headers: { "set-cookie": expiredSessionCookie(request), "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
