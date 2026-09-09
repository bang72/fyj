import { getDatabase } from "@/lib/database";
import { hmacSha256, publicId, randomId, safeEqual, sha256 } from "@/lib/mivo-core";
import { createNotification, runtimeValue } from "@/lib/server-foundation";

function verifyHeader(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return Promise.resolve(false);
  return hmacSha256(secret, `${timestamp}.${payload}`).then((expected) => signatures.some((signature) => safeEqual(expected, signature)));
}

type StripeObject = {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: { mivo_user_id?: string; mivo_plan?: string };
};

export async function POST(request: Request) {
  const secret = runtimeValue("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook disabled", { status: 503 });
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!(await verifyHeader(payload, signature, secret))) return new Response("Invalid signature", { status: 400 });
  let event: { id: string; type: string; data: { object: StripeObject } };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const duplicate = await getDatabase().prepare("SELECT 1 AS found FROM subscription_events WHERE provider = 'stripe' AND provider_event_id = ? LIMIT 1").bind(event.id).first();
  if (duplicate) return Response.json({ received: true, duplicate: true });
  const object = event.data.object;
  const metadata = object.metadata ?? {};
  const userId = metadata.mivo_user_id;
  const plan = metadata.mivo_plan;
  const now = new Date().toISOString();
  let entitlementStatus: string | null = null;
  const statements = [getDatabase().prepare("INSERT INTO subscription_events (id, provider, provider_event_id, event_type, payload_hash, processed_at) VALUES (?, 'stripe', ?, ?, ?, ?)")
    .bind(randomId("subevt"), event.id, event.type, await sha256(payload), now)];
  if (userId && (plan === "PLUS" || plan === "MAX") && event.type === "checkout.session.completed") {
    statements.push(getDatabase().prepare(
      "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, 'subscription_started', 'subscription', ?, ?, ?)",
    ).bind(randomId("aud"), userId, object.subscription ?? object.id ?? null, JSON.stringify({ plan, provider: "stripe" }), now));
  }
  if (userId && (plan === "PLUS" || plan === "MAX") && object.id && event.type !== "checkout.session.completed") {
    const subscriptionId = object.id;
    const statusRaw = String(object.status ?? "expired");
    const status = ["active", "trialing", "past_due", "cancelled"].includes(statusRaw) ? statusRaw : "expired";
    entitlementStatus = status;
    const periodStart = object.current_period_start ? new Date(object.current_period_start * 1000).toISOString() : null;
    const periodEnd = object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null;
    statements.push(getDatabase().prepare(
      `INSERT INTO subscriptions (id, user_id, provider, provider_customer_id, provider_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET plan = excluded.plan, status = excluded.status,
       provider_customer_id = excluded.provider_customer_id, current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = excluded.updated_at`,
    ).bind(randomId("sub"), userId, object.customer ?? null, subscriptionId ?? object.id, plan, status, periodStart, periodEnd, object.cancel_at_period_end ? 1 : 0, now, now));
  }
  try {
    await getDatabase().batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique")) return Response.json({ received: true, duplicate: true });
    throw error;
  }
  if (userId && (plan === "PLUS" || plan === "MAX") && event.type !== "checkout.session.completed") {
    const active = entitlementStatus === "active" || entitlementStatus === "trialing";
    await createNotification(userId, "subscription", active ? `${plan} is active` : "Subscription updated", active ? "Gender filtering is ready to use." : "Your subscription needs attention or has ended.", publicId("billing"));
  }
  return Response.json({ received: true });
}
