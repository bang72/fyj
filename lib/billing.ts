
import { runtimeValue } from "@/lib/server-foundation";

export type PaidPlan = "PLUS" | "MAX";

export type ProviderSubscription = {
  id: string;
  customerId: string;
  plan: PaidPlan;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export interface BillingProvider {
  readonly name: string;
  createCheckout(input: { userId: string; userPublicId: string; plan: PaidPlan; customerId: string | null; origin: string }): Promise<string>;
  createPortal(customerId: string, returnUrl: string): Promise<string>;
  listSubscriptions(customerId: string, expectedUserId: string): Promise<ProviderSubscription[]>;
}

function isoFromEpoch(value: unknown) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function safeProviderUrl(value: unknown, hosts: string[]) {
  if (typeof value !== "string") throw new Error("PAYMENT_PROVIDER_ERROR");
  const url = new URL(value);
  if (url.protocol !== "https:" || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("PAYMENT_PROVIDER_ERROR");
  return url.toString();
}

class StripeProvider implements BillingProvider {
  readonly name = "stripe";

  constructor(private readonly secret: string) {}

  private async request(path: string, body?: URLSearchParams) {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${this.secret}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body,
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      console.error("stripe_request_failed", path, response.status);
      throw new Error("PAYMENT_PROVIDER_ERROR");
    }
    return data;
  }

  async createCheckout(input: { userId: string; userPublicId: string; plan: PaidPlan; customerId: string | null; origin: string }) {
    const price = runtimeValue(input.plan === "PLUS" ? "STRIPE_PRICE_PLUS" : "STRIPE_PRICE_MAX");
    if (!price) throw new Error("BILLING_PLAN_UNAVAILABLE");
    const configuredPrice = await this.request(`prices/${encodeURIComponent(price)}`);
    const recurring = configuredPrice.recurring as Record<string, unknown> | undefined;
    // Stripe represents IDR in minor units, so Rp20.000 and Rp30.000 are multiplied by 100.
    const expectedAmount = input.plan === "PLUS" ? 2_000_000 : 3_000_000;
    if (configuredPrice.currency !== "idr" || configuredPrice.unit_amount !== expectedAmount || recurring?.interval !== "month") {
      console.error("stripe_price_mismatch", input.plan);
      throw new Error("BILLING_PLAN_UNAVAILABLE");
    }
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      client_reference_id: input.userPublicId,
      "metadata[mivo_user_id]": input.userId,
      "metadata[mivo_plan]": input.plan,
      "subscription_data[metadata][mivo_user_id]": input.userId,
      "subscription_data[metadata][mivo_plan]": input.plan,
      success_url: `${input.origin}/?billing=success`,
      cancel_url: `${input.origin}/?billing=cancelled`,
      allow_promotion_codes: "true",
    });
    if (input.customerId) params.set("customer", input.customerId);
    const result = await this.request("checkout/sessions", params);
    return safeProviderUrl(result.url, ["stripe.com"]);
  }

  async createPortal(customerId: string, returnUrl: string) {
    const result = await this.request("billing_portal/sessions", new URLSearchParams({ customer: customerId, return_url: returnUrl }));
    return safeProviderUrl(result.url, ["stripe.com"]);
  }

  async listSubscriptions(customerId: string, expectedUserId: string) {
    const result = await this.request(`subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`);
    const items = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    return items.flatMap((item): ProviderSubscription[] => {
      const metadata = (item.metadata ?? {}) as Record<string, string>;
      if (metadata.mivo_user_id !== expectedUserId || !["PLUS", "MAX"].includes(metadata.mivo_plan) || typeof item.id !== "string") return [];
      return [{
        id: item.id,
        customerId,
        plan: metadata.mivo_plan as PaidPlan,
        status: String(item.status ?? "expired"),
        currentPeriodStart: isoFromEpoch(item.current_period_start),
        currentPeriodEnd: isoFromEpoch(item.current_period_end),
        cancelAtPeriodEnd: Boolean(item.cancel_at_period_end),
      }];
    });
  }
}

export function getBillingProvider(): BillingProvider | null {
  const provider = runtimeValue("PAYMENT_PROVIDER") ?? "stripe";
  if (provider !== "stripe") throw new Error("MIVO_CONFIG_PAYMENT_PROVIDER");
  const secret = runtimeValue("STRIPE_SECRET_KEY");
  const webhookSecret = runtimeValue("STRIPE_WEBHOOK_SECRET");
  return secret && webhookSecret ? new StripeProvider(secret) : null;
}
