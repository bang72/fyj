import { z } from "zod";

import { getDatabase } from "@/lib/database";
import { PASSWORD_ALGORITHM, PASSWORD_ITERATIONS, normalizeUsername, verifyPassword } from "@/lib/mivo-core";
import { assertSameOrigin, consumeRateLimit, jsonError, prepareSession, requiredSecret } from "@/lib/server-foundation";

const schema = z.object({ username: z.string().max(80), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await consumeRateLimit(request, "login", 12, 900))) {
      return Response.json({ error: "Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba lagi." }, { status: 429 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Username atau password belum benar." }, { status: 400 });
    const username = normalizeUsername(parsed.data.username);
    const row = await getDatabase().prepare(
      `SELECT u.id, u.status, u.suspended_until, u.moderation_reason, c.password_hash, c.password_salt, c.password_algorithm, c.password_iterations
       FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.username = ? LIMIT 1`,
    ).bind(username).first<{ id: string; status: string; suspended_until: string | null; moderation_reason: string | null; password_hash: string; password_salt: string; password_algorithm: string; password_iterations: number }>();
    const passwordPepper = requiredSecret("PASSWORD_PEPPER");
    const passwordMatches = row
      ? await verifyPassword(parsed.data.password, passwordPepper, row.password_salt, row.password_hash, row.password_algorithm, row.password_iterations)
      : await verifyPassword(parsed.data.password, passwordPepper, "00000000000000000000000000000000", "0000000000000000000000000000000000000000000000000000000000000000", PASSWORD_ALGORITHM, PASSWORD_ITERATIONS);
    if (!row || !passwordMatches) {
      return Response.json({ error: "Username atau password belum benar." }, { status: 401 });
    }
    const now = new Date().toISOString();
    if (row.status === "suspended") {
      if (row.suspended_until && row.suspended_until <= now) {
        await getDatabase().prepare("UPDATE users SET status = 'active', suspended_until = NULL, moderation_reason = NULL, updated_at = ? WHERE id = ? AND status = 'suspended'").bind(now, row.id).run();
        row.status = "active";
      } else {
        const until = row.suspended_until ? new Date(row.suspended_until).toLocaleString("id-ID") : "sampai ditinjau kembali";
        return Response.json({ error: `Akun ini ditangguhkan ${until}.` }, { status: 403 });
      }
    }
    if (row.status === "banned") return Response.json({ error: "Akun ini diblokir permanen oleh MIVO." }, { status: 403 });
    if (row.status !== "active") return Response.json({ error: "Akun ini tidak dapat digunakan." }, { status: 403 });
    const session = await prepareSession(row.id, request);
    await getDatabase().batch([
      session.statement,
      getDatabase().prepare("INSERT INTO presence (user_id, status, last_heartbeat_at, updated_at) VALUES (?, 'online', ?, ?) ON CONFLICT(user_id) DO UPDATE SET status = 'online', last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at").bind(row.id, now, now),
    ]);
    return Response.json({ ok: true }, { headers: { "set-cookie": session.cookie, "cache-control": "no-store" } });
  } catch (error) {
    console.error("login_failed", error);
    return jsonError(error);
  }
}
