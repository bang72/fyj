
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type RunResult = { success: boolean; meta: { changes: number; last_row_id?: number } };

export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<RunResult>;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<RunResult[]>;
}

export interface BucketObject {
  body: ReadableStream;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
}

export interface Bucket {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<BucketObject | null>;
  delete(key: string): Promise<void>;
}

function environmentValue(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function databaseConfigured() {
  return Boolean(environmentValue("DATABASE_URL"));
}

export function storageConfigured() {
  return Boolean(
    environmentValue("S3_BUCKET") &&
      environmentValue("S3_ACCESS_KEY_ID") &&
      environmentValue("S3_SECRET_ACCESS_KEY"),
  );
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string | ArrayBuffer) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const raw = key instanceof ArrayBuffer ? key : Uint8Array.from(key).buffer;
  const imported = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(value)));
}

/**
 * Convert the legacy question-mark placeholder surface used by the MIVO query layer
 * into PostgreSQL positional parameters. Question marks inside quoted SQL
 * strings are intentionally left untouched.
 */
function postgresPlaceholders(sql: string) {
  let position = 0;
  let quote: "'" | '"' | null = null;
  let output = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (quote) {
      output += char;
      if (char === quote) {
        if (next === quote) {
          output += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }

    if (char === "?") {
      output += `$${++position}`;
      continue;
    }

    output += char;
  }

  return output;
}

class S3Bucket implements Bucket {
  constructor(
    private readonly bucket: string,
    private readonly region: string,
    private readonly endpoint: string | null,
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  private objectUrl(key: string) {
    const safeKey = key.split("/").map(encodeURIComponent).join("/");
    return this.endpoint
      ? new URL(`${this.endpoint.replace(/\/$/, "")}/${encodeURIComponent(this.bucket)}/${safeKey}`)
      : new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com/${safeKey}`);
  }

  private async request(method: string, key: string, body?: ArrayBuffer, headers: Record<string, string> = {}) {
    const url = this.objectUrl(key);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("MIVO_STORAGE_INSECURE_ENDPOINT");

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const bodyHash = await digest(body ?? new ArrayBuffer(0));
    const canonicalHeaders: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()])),
    };
    const names = Object.keys(canonicalHeaders).sort();
    const canonical = `${method}\n${url.pathname}\n\n${names.map((name) => `${name}:${canonicalHeaders[name]}\n`).join("")}\n${names.join(";")}\n${bodyHash}`;
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await digest(canonical)}`;
    const dateKey = await hmac(new TextEncoder().encode(`AWS4${this.secretKey}`), date);
    const regionKey = await hmac(dateKey, this.region);
    const serviceKey = await hmac(regionKey, "s3");
    const signingKey = await hmac(serviceKey, "aws4_request");
    const signature = hex(await hmac(signingKey, stringToSign));
    const outgoing = new Headers(canonicalHeaders);
    outgoing.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    );
    const response = await fetch(url, { method, headers: outgoing, body: body ? new Uint8Array(body) : undefined });
    if (!response.ok && response.status !== 404) throw new Error(`MIVO_STORAGE_${response.status}`);
    return response;
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) {
    const buffer = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer();
    const headers: Record<string, string> = {};
    if (options?.httpMetadata?.contentType) headers["content-type"] = options.httpMetadata.contentType;
    for (const [name, value] of Object.entries(options?.customMetadata ?? {})) {
      headers[`x-amz-meta-${name.toLowerCase()}`] = value;
    }
    const response = await this.request("PUT", key, buffer, headers);
    return { etag: response.headers.get("etag") };
  }

  async get(key: string) {
    const response = await this.request("GET", key);
    if (response.status === 404 || !response.body) return null;
    const contentType = response.headers.get("content-type") ?? undefined;
    return { body: response.body, httpEtag: response.headers.get("etag") ?? undefined, httpMetadata: { contentType } };
  }

  async delete(key: string) {
    await this.request("DELETE", key);
  }
}

class NeonStatement implements PreparedStatement {
  constructor(
    private readonly client: NeonQueryFunction<false, true>,
    readonly rawSql: string,
    readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new NeonStatement(this.client, this.rawSql, values);
  }

  private sql() {
    return postgresPlaceholders(this.rawSql);
  }

  async query() {
    return this.client.query(this.sql(), this.values, { fullResults: true });
  }

  async first<T>() {
    const result = await this.query();
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T>() {
    const result = await this.query();
    return { results: result.rows as T[], success: true };
  }

  async run(): Promise<RunResult> {
    const result = await this.query();
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }
}

class NeonDatabase implements Database {
  readonly client: NeonQueryFunction<false, true>;

  constructor(url: string) {
    this.client = neon(url, { fullResults: true });
  }

  prepare(sql: string) {
    return new NeonStatement(this.client, sql);
  }

  async batch(statements: PreparedStatement[]) {
    const neonStatements = statements as NeonStatement[];
    const results = await this.client.transaction(
      (tx) => neonStatements.map((statement) => tx.query(postgresPlaceholders(statement.rawSql), statement.values)),
      { fullResults: true, isolationLevel: "Serializable" },
    );
    return results.map((result) => ({ success: true, meta: { changes: result.rowCount ?? 0 } }));
  }
}

let database: Database | null = null;
let bucket: Bucket | null = null;

export function getDatabase(): Database {
  const url = environmentValue("DATABASE_URL");
  if (!url) throw new Error("MIVO_DATABASE_UNAVAILABLE");
  database ??= new NeonDatabase(url);
  return database;
}

export function getBucket(): Bucket {
  const name = environmentValue("S3_BUCKET");
  const accessKey = environmentValue("S3_ACCESS_KEY_ID");
  const secretKey = environmentValue("S3_SECRET_ACCESS_KEY");
  if (!name || !accessKey || !secretKey) throw new Error("MIVO_STORAGE_UNAVAILABLE");

  bucket ??= new S3Bucket(
    name,
    environmentValue("S3_REGION") ?? "auto",
    environmentValue("S3_ENDPOINT"),
    accessKey,
    secretKey,
  );
  return bucket;
}
