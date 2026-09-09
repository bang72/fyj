
import { runtimeValue } from "@/lib/server-foundation";

function parseKey() {
  const apiKey = runtimeValue("ABLY_API_KEY");
  if (!apiKey) return null;
  const separator = apiKey.indexOf(":");
  if (separator < 1 || separator === apiKey.length - 1) throw new Error("MIVO_CONFIG_ABLY_API_KEY");
  return { raw: apiKey, name: apiKey.slice(0, separator), secret: apiKey.slice(separator + 1) };
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

async function signJwt(input: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input))));
}

export function realtimeEnabled() {
  return Boolean(runtimeValue("ABLY_API_KEY"));
}

export async function createRealtimeJwt(clientId: string, channels: string[]) {
  const key = parseKey();
  if (!key) throw new Error("REALTIME_DISABLED");
  const now = Math.floor(Date.now() / 1000);
  const capability: Record<string, string[]> = {};
  for (const channel of channels) capability[channel] = ["subscribe", "presence"];
  const header = textToBase64Url(JSON.stringify({ typ: "JWT", alg: "HS256", kid: key.name }));
  const claims = textToBase64Url(JSON.stringify({
    iat: now,
    exp: now + 45 * 60,
    "x-ably-clientId": clientId,
    "x-ably-capability": JSON.stringify(capability),
  }));
  const input = `${header}.${claims}`;
  return `${input}.${await signJwt(input, key.secret)}`;
}

export async function publishRealtime(channel: string, name: string, data: unknown) {
  const key = parseKey();
  if (!key) return false;
  const response = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(key.raw)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, data }),
  });
  if (!response.ok) {
    console.error("ably_publish_failed", response.status);
    return false;
  }
  return true;
}
