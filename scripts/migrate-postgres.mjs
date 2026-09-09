import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../db/migrations");
const client = neon(databaseUrl, { fullResults: true });

await client.query(
  `CREATE TABLE IF NOT EXISTS mivo_schema_migrations (
     name text PRIMARY KEY NOT NULL,
     applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  [],
  { fullResults: true },
);

const files = (await readdir(migrationsDir))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));

const appliedResult = await client.query("SELECT name FROM mivo_schema_migrations ORDER BY name", [], { fullResults: true });
const applied = new Set(appliedResult.rows.map((row) => String(row.name)));

// MIVO V1 shipped before the versioned ledger. If an existing database already
// has the complete baseline tables, register the initial migration instead of
// attempting to recreate production data.
if (!applied.has("0001_initial.sql")) {
  const existing = await client.query("SELECT to_regclass('public.users') AS users", [], { fullResults: true });
  if (existing.rows[0]?.users) {
    await client.query("INSERT INTO mivo_schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", ["0001_initial.sql"], { fullResults: true });
    applied.add("0001_initial.sql");
    console.log("Baselined existing MIVO schema as 0001_initial.sql.");
  }
}

for (const file of files) {
  if (applied.has(file)) continue;
  const source = await readFile(resolve(migrationsDir, file), "utf8");
  const statements = source
    .replace(/^--.*$/gm, "")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement && statement !== "BEGIN" && statement !== "COMMIT");

  await client.transaction(
    (transaction) => [
      ...statements.map((statement) => transaction.query(statement)),
      transaction.query("INSERT INTO mivo_schema_migrations (name) VALUES ($1)", [file]),
    ],
    { fullResults: true, isolationLevel: "Serializable" },
  );
  console.log(`Applied ${file} (${statements.length} statements).`);
}

console.log("MIVO database migrations are up to date.");
