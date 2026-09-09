import { databaseConfigured, getDatabase, storageConfigured } from "@/lib/database";
import { realtimeEnabled } from "@/lib/realtime";
import { runtimeValue } from "@/lib/server-foundation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "2.1.0";
const REQUIRED_MIGRATION = "0003_admin_console.sql";

function secretReady(name: "AUTH_SECRET" | "SECURITY_PEPPER" | "PASSWORD_PEPPER") {
  return (runtimeValue(name)?.length ?? 0) >= 32;
}

export async function GET() {
  const startedAt = Date.now();
  const configured = databaseConfigured();
  let database = false;
  let databaseLatencyMs: number | null = null;
  let schemaReady = false;
  let latestMigration: string | null = null;

  if (configured) {
    const before = Date.now();
    try {
      const result = await getDatabase().prepare("SELECT 1 AS ok").first<{ ok: number }>();
      database = Number(result?.ok) === 1;
      databaseLatencyMs = Date.now() - before;
      if (database) {
        const migration = await getDatabase().prepare("SELECT name FROM mivo_schema_migrations ORDER BY name DESC LIMIT 1").first<{ name: string }>();
        latestMigration = migration?.name ?? null;
        const required = await getDatabase().prepare("SELECT 1 AS ok FROM mivo_schema_migrations WHERE name = ? LIMIT 1").bind(REQUIRED_MIGRATION).first<{ ok: number }>();
        schemaReady = Number(required?.ok) === 1;
      }
    } catch (error) {
      console.error("health_database_failed", error);
    }
  }

  const auth = secretReady("AUTH_SECRET") && secretReady("SECURITY_PEPPER") && secretReady("PASSWORD_PEPPER");
  const billing = Boolean(
    runtimeValue("STRIPE_SECRET_KEY") &&
      runtimeValue("STRIPE_WEBHOOK_SECRET") &&
      runtimeValue("STRIPE_PRICE_PLUS") &&
      runtimeValue("STRIPE_PRICE_MAX"),
  );
  const ready = database && schemaReady && auth;

  return Response.json(
    {
      service: "mivo",
      version: VERSION,
      status: ready ? "ready" : "configuration_required",
      environment: runtimeValue("VERCEL_ENV") ?? process.env.NODE_ENV ?? "unknown",
      checks: {
        database: { configured, reachable: database, latencyMs: databaseLatencyMs, schemaReady, latestMigration, requiredMigration: REQUIRED_MIGRATION },
        auth,
        realtime: realtimeEnabled(),
        billing,
        storage: storageConfigured(),
      },
      durationMs: Date.now() - startedAt,
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-mivo-version": VERSION,
      },
    },
  );
}
