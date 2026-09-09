import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const core = await import(path.join(root, "lib/mivo-core.ts"));

test("security and entitlement rules are deterministic", async () => {
  assert.equal(core.isAdult("2000-02-29", new Date("2026-02-28T12:00:00Z")), true);
  assert.equal(core.isAdult("2010-01-01", new Date("2026-01-02T00:00:00Z")), false);
  assert.match(core.usernameError("admin"), /dicadangkan/);
  assert.match(core.passwordError("password123", "person"), /mudah/);
  assert.deepEqual(core.canUseGenderFilter("FREE", 0), { allowed: false, remaining: 0 });
  assert.deepEqual(core.canUseGenderFilter("PLUS", 19), { allowed: true, remaining: 1 });
  assert.deepEqual(core.canUseGenderFilter("PLUS", 20), { allowed: false, remaining: 0 });
  assert.deepEqual(core.canUseGenderFilter("MAX", 999), { allowed: true, remaining: null });
  assert.equal(core.overlapScore(["music", "gaming"], ["gaming", "study"]), 1);
  assert.equal(core.retentionDecision("keep", "keep", new Date(0)).connect, true);
  assert.equal(core.retentionDecision("7d", "24h", new Date(0)).expiresAt, new Date(86_400_000).toISOString());
  assert.equal(core.containsSuspiciousUrl("visit https://bit.ly/not-safe"), true);

  const pepper = "test-password-pepper-longer-than-thirty-two-characters";
  const password = await core.hashPassword("Solstice!River47", pepper);
  assert.equal(password.iterations, 100_000);
  assert.equal(await core.verifyPassword("Solstice!River47", pepper, password.salt, password.hash, password.algorithm, password.iterations), true);
  assert.equal(await core.verifyPassword("wrong-password", pepper, password.salt, password.hash, password.algorithm, password.iterations), false);
});

test("V2 is Vercel-first and has one standard build path", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const vercel = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
  assert.equal(pkg.version, "2.1.0");
  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.start, "next start");
  assert.equal(vercel.framework, "nextjs");
  assert.equal(vercel.buildCommand, "npm run build");
  for (const forbidden of ["vinext", "wrangler", "@cloudflare/vite-plugin", "vite"]) {
    assert.equal(Boolean(pkg.dependencies?.[forbidden] || pkg.devDependencies?.[forbidden]), false, `${forbidden} should not be installed`);
  }
  await access(path.join(root, "app/api/health/route.ts"));
});

test("V2 migrations include private conversation feedback", async () => {
  const initial = await readFile(path.join(root, "db/migrations/0001_initial.sql"), "utf8");
  const feedback = await readFile(path.join(root, "db/migrations/0002_v2_conversation_feedback.sql"), "utf8");
  assert.match(initial, /CREATE TABLE "users"/);
  assert.match(initial, /CREATE TABLE "rooms"/);
  assert.match(feedback, /CREATE TABLE "conversation_feedback"/);
  assert.match(feedback, /PRIMARY KEY\("room_id", "user_id"\)/);
});


test("V2.1 includes protected admin bootstrap and moderation controls", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const adminMigration = await readFile(path.join(root, "db/migrations/0003_admin_console.sql"), "utf8");
  const bootstrap = await readFile(path.join(root, "scripts/bootstrap-admin.mjs"), "utf8");
  const usersRoute = await readFile(path.join(root, "app/api/admin/users/route.ts"), "utf8");
  const moderationRoute = await readFile(path.join(root, "app/api/moderation/route.ts"), "utf8");
  assert.match(pkg.scripts["admin:bootstrap"], /bootstrap-admin\.mjs/);
  assert.match(adminMigration, /suspended_until/);
  assert.match(adminMigration, /moderation_notes/);
  assert.match(bootstrap, /MIVO_ADMIN_PASSWORD/);
  assert.doesNotMatch(bootstrap, /MIVO_ADMIN_PASSWORD\s*=\s*["'][^"']+["']/);
  assert.match(usersRoute, /force_logout/);
  assert.match(usersRoute, /clear_warnings/);
  assert.match(moderationRoute, /set_priority/);
  assert.match(moderationRoute, /assigned_moderator_id/);
});
