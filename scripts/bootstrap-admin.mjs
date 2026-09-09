import { webcrypto } from "node:crypto";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const crypto = webcrypto;
const PASSWORD_ALGORITHM = "pbkdf2-sha256-peppered-2x-v2";
const PASSWORD_ITERATIONS = 100_000;
const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function bytesToHex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex) { const out = new Uint8Array(hex.length / 2); for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16); return out; }
function randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); }
function randomId(prefix, bytes = 12) { return `${prefix}_${bytesToHex(randomBytes(bytes))}`; }
function base32(bytes) { let bits = 0, value = 0, output = ""; for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]; return output; }
function publicId(prefix) { return `${prefix}_${base32(randomBytes(10)).slice(0, 16).toLowerCase()}`; }
async function hmacSha256(secret, value) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))); }
async function hashPassword(password, pepper) {
  const salt = bytesToHex(randomBytes(16));
  const baseSalt = hexToBytes(salt);
  let material = hexToBytes(await hmacSha256(pepper, password));
  for (let round = 1; round <= 2; round += 1) {
    const roundSalt = new Uint8Array(baseSalt.length + 1); roundSalt.set(baseSalt); roundSalt[baseSalt.length] = round;
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    material = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: roundSalt, iterations: PASSWORD_ITERATIONS }, key, 256));
  }
  return { hash: bytesToHex(material), salt };
}

export async function bootstrapAdmin() {
  const databaseUrl = env("DATABASE_URL");
  const username = env("MIVO_ADMIN_USERNAME")?.toLowerCase().replace(/^@/, "");
  const password = env("MIVO_ADMIN_PASSWORD");
  const pepper = env("PASSWORD_PEPPER");
  const alias = env("MIVO_ADMIN_ALIAS") ?? "MIVO Admin";

  if (!username && !password) {
    console.log("Admin bootstrap skipped: MIVO_ADMIN_USERNAME / MIVO_ADMIN_PASSWORD are not configured.");
    return;
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required for admin bootstrap.");
  if (!username || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error("MIVO_ADMIN_USERNAME must be 3-32 safe characters.");
  if (!password || password.length < 14 || password.length > 128) throw new Error("MIVO_ADMIN_PASSWORD must be 14-128 characters.");
  if (!pepper || pepper.length < 32) throw new Error("PASSWORD_PEPPER must be at least 32 characters.");

  const client = neon(databaseUrl, { fullResults: true });
  const existingAdmin = await client.query("SELECT id, username FROM users WHERE role = 'ADMIN' AND status != 'deleted' ORDER BY created_at LIMIT 1", [], { fullResults: true });
  if (existingAdmin.rows.length > 0) {
    console.log(`Admin bootstrap skipped: administrator @${existingAdmin.rows[0].username} already exists.`);
    return;
  }
  const existingUsername = await client.query("SELECT id FROM users WHERE username = $1 LIMIT 1", [username], { fullResults: true });
  if (existingUsername.rows.length > 0) throw new Error(`Cannot bootstrap admin: username @${username} already exists.`);

  const id = randomId("usr");
  const pid = publicId("person");
  const now = new Date().toISOString();
  const credential = await hashPassword(password, pepper);
  const hue = Math.floor(Math.random() * 360);

  await client.transaction((tx) => [
    tx.query(`INSERT INTO users (id, public_id, username, status, role, trust_score, trust_band, created_at, updated_at)
              VALUES ($1, $2, $3, 'active', 'ADMIN', 100, 'trusted', $4, $4)`, [id, pid, username, now]),
    tx.query(`INSERT INTO credentials (user_id, password_hash, password_salt, password_algorithm, password_iterations, password_changed_at)
              VALUES ($1, $2, $3, $4, $5, $6)`, [id, credential.hash, credential.salt, PASSWORD_ALGORITHM, PASSWORD_ITERATIONS, now]),
    tx.query("INSERT INTO profiles (user_id, alias, avatar_hue, bio, created_at, updated_at) VALUES ($1, $2, $3, 'Official MIVO administrator', $4, $4)", [id, alias, hue, now]),
    tx.query("INSERT INTO identities (user_id, birth_date, gender, age_visibility, location_consent, updated_at) VALUES ($1, '1990-01-01', 'private', 'hidden', 0, $2)", [id, now]),
    tx.query("INSERT INTO preferences (user_id, desired_gender, read_receipts, sensitive_media, reconnect_policy, appearance, push_enabled, updated_at) VALUES ($1, 'random', 1, 'block', 'nobody', 'dark', 0, $2)", [id, now]),
    tx.query("INSERT INTO verification_status (user_id, status, updated_at) VALUES ($1, 'not_started', $2)", [id, now]),
    tx.query("INSERT INTO admin_bootstrap_state (id, bootstrapped_by_id, created_at) VALUES ('initial', $1, $2) ON CONFLICT (id) DO NOTHING", [id, now]),
    tx.query("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json, created_at) VALUES ($1, $2, 'admin_account_created', 'user', $2, $3, $4)", [randomId("aud"), id, JSON.stringify({ source: "env_bootstrap", username }), now]),
  ], { fullResults: true, isolationLevel: "Serializable" });

  console.log(`Created initial MIVO ADMIN account @${username}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await bootstrapAdmin();
