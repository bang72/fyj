import { z } from "zod";

import { getBillingProvider } from "@/lib/billing";
import { getDatabase } from "@/lib/database";
import { randomId } from "@/lib/mivo-core";
import { assertSameOrigin, jsonError, requireViewer, runtimeValue } from "@/lib/server-foundation";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), plan: z.enum(["PLUS", "MAX"]) }),
  z.object({ action: z.literal("manage") }),
  z.object({ action: z.literal("restore") }),
]);

function allowedOrigin(request: Request) {
  const configured = runtimeValue("APP_ORIGIN");
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Pilihan pembayaran belum valid." }, { status: 400 });
    const body = parsed.data;
    const provider = getBillingProvider();
    if (!provider) return Response.json({ error: "Pembayaran belum tersedia pada deployment ini." }, { status: 503 });
    const existing = await getDatabase().prepare("SELECT provider_customer_id FROM subscriptions WHERE user_id = ? AND provider = ? AND provider_customer_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1")
      .bind(viewer.id, provider.name).first<{ provider_customer_id: string }>();
    const origin = allowedOrigin(request);

    if (body.action === "checkout") {
      const url = await provider.createCheckout({ userId: viewer.id, userPublicId: viewer.public_id, plan: body.plan, customerId: existing?.provider_customer_id ?? null, origin });
      return Response.json({ url });
    }

    if (!existing?.provider_customer_id) return Response.json({ error: "Belum ada pembelian yang terhubung ke akun ini." }, { status: 404 });
    if (body.action === "manage") {
      return Response.json({ url: await provider.createPortal(existing.provider_customer_id, `${origin}/`) });
    }

    const items = await provider.listSubscriptions(existing.provider_customer_id, viewer.id);
    let restored = false;
    for (const item of items) {
      const active = ["active", "trialing"].includes(item.status);
      await getDatabase().prepare(
        `INSERT INTO subscriptions (id, user_id, provider, provider_customer_id, provider_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET plan = excluded.plan, status = excluded.status,
         current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at`,
      ).bind(randomId("sub"), viewer.id, provider.name, item.customerId, item.id, item.plan, active ? item.status : "expired", item.currentPeriodStart, item.currentPeriodEnd, item.cancelAtPeriodEnd ? 1 : 0, new Date().toISOString(), new Date().toISOString()).run();
      restored ||= active;
    }
    return Response.json({ restored });
  } catch (error) {
    console.error("billing_failed", error);
    const code = error instanceof Error ? error.message : "";
    if (code === "PAYMENT_PROVIDER_ERROR") return Response.json({ error: "Penyedia pembayaran gagal merespons. Coba lagi." }, { status: 502 });
    if (code === "BILLING_PLAN_UNAVAILABLE") return Response.json({ error: "Paket itu belum dikonfigurasi." }, { status: 503 });
    return jsonError(error);
  }
}
