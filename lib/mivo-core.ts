export const VIBES = [
  { id: "chill", label: "Chill" },
  { id: "deep-talk", label: "Deep Talk" },
  { id: "friendship", label: "Friendship" },
  { id: "gaming", label: "Gaming" },
  { id: "music", label: "Music" },
  { id: "movies", label: "Movies" },
  { id: "study", label: "Study" },
  { id: "relationship-talk", label: "Relationship Talk" },
  { id: "random", label: "Random" },
] as const;

export const VIBE_IDS = new Set<string>(VIBES.map((vibe) => vibe.id));

export const REPORT_CATEGORIES = [
  "harassment",
  "sexual_content",
  "spam",
  "scam",
  "threat",
  "hate",
  "underage_concern",
  "impersonation",
  "other",
] as const;

export const ICEBREAKERS: Record<string, readonly string[]> = {
  Funny: [
    "Kalau hidupmu punya tombol undo, momen receh apa yang pertama kamu batalkan?",
    "Makanan apa yang tetap kamu bela walaupun semua orang bilang aneh?",
    "Kalau hewan peliharaanmu bisa memberi review tentangmu, kira-kira berapa bintang?",
    "Kebiasaan kecil apa yang sebenarnya lucu tapi kamu kira cuma kamu yang melakukannya?",
  ],
  Random: [
    "Pilih satu: bisa menghentikan waktu atau mengulang satu hari?",
    "Apa benda paling tidak penting yang selalu kamu bawa?",
    "Kalau besok bebas dari semua kewajiban, kamu mau bangun jam berapa?",
    "Kota mana yang ingin kamu datangi tanpa membuat itinerary?",
  ],
  Deep: [
    "Kapan terakhir kali kamu merasa benar-benar dipahami?",
    "Nilai hidup apa yang tidak mau kamu kompromikan?",
    "Apa hal yang sekarang kamu pahami, tetapi dulu sulit kamu terima?",
    "Menurutmu, seperti apa bentuk perhatian yang paling tulus?",
  ],
  Dreams: [
    "Kalau gagal bukan masalah, apa yang paling ingin kamu coba?",
    "Versi dirimu lima tahun lagi sedang berterima kasih atas keputusan apa hari ini?",
    "Mimpi kecil apa yang belum pernah kamu ceritakan ke banyak orang?",
    "Apa proyek pribadi yang ingin kamu selesaikan setidaknya sekali seumur hidup?",
  ],
  Music: [
    "Lagu apa yang akhir-akhir ini terasa seperti soundtrack hidupmu?",
    "Artis mana yang ingin kamu tonton langsung setidaknya sekali?",
    "Kamu lebih suka menemukan lagu baru atau mengulang lagu lama yang nyaman?",
    "Kalau suasana malam ini jadi genre musik, genrenya apa?",
  ],
  Gaming: [
    "Game apa yang bisa kamu mainkan lagi dari awal tanpa bosan?",
    "Kamu tipe yang mengejar cerita, rank, eksplorasi, atau sekadar mabar?",
    "NPC mana yang menurutmu pantas punya game sendiri?",
    "Kalau hidup punya skill tree, skill apa yang sedang kamu naikkan?",
  ],
  Life: [
    "Hal sederhana apa yang sedang membuat harimu sedikit lebih baik?",
    "Rutinitas kecil apa yang paling membantu saat pikiran ramai?",
    "Apa sesuatu yang ingin kamu pelajari tahun ini?",
    "Lebih mudah bagimu memulai sesuatu atau menyelesaikannya?",
  ],
};

const ALIAS_ADJECTIVES = ["Mysterious", "Quiet", "Midnight", "Cosmic", "Gentle", "Curious", "Velvet", "Electric"];
const ALIAS_ANIMALS = ["Fox", "Moth", "Raven", "Otter", "Panda", "Lynx", "Gecko", "Whale"];
const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const PASSWORD_ALGORITHM = "pbkdf2-sha256-peppered-2x-v2";
// The hosted Web Crypto implementation accepts at most 100k iterations per
// deriveBits operation. Two sequential rounds preserve a 200k work factor,
// while the server-only pepper prevents useful offline guesses from a DB leak.
export const PASSWORD_ITERATIONS = 100_000;
export const SESSION_DAYS = 30;
export const PLUS_DAILY_FILTERED_MATCHES = 20;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const result = new Uint8Array(hex.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

export function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomId(prefix: string, bytes = 12) {
  return `${prefix}_${bytesToHex(randomBytes(bytes))}`;
}

export function publicId(prefix: string) {
  return `${prefix}_${base32(randomBytes(10)).slice(0, 16).toLowerCase()}`;
}

function base32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function createRecoveryCode() {
  const raw = base32(randomBytes(10)).slice(0, 16);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

export function normalizeRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

export async function hashPassword(password: string, pepper: string, salt = bytesToHex(randomBytes(16)), iterations = PASSWORD_ITERATIONS) {
  if (pepper.length < 32 || iterations !== PASSWORD_ITERATIONS) throw new Error("INVALID_PASSWORD_HASH_CONFIG");
  const baseSalt = hexToBytes(salt);
  let material = hexToBytes(await hmacSha256(pepper, password));
  for (let round = 1; round <= 2; round += 1) {
    const roundSalt = new Uint8Array(baseSalt.length + 1);
    roundSalt.set(baseSalt);
    roundSalt[baseSalt.length] = round;
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: roundSalt, iterations },
      key,
      256,
    );
    material = new Uint8Array(bits);
  }
  return { hash: bytesToHex(material), salt, iterations, algorithm: PASSWORD_ALGORITHM };
}

export function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function verifyPassword(password: string, pepper: string, salt: string, expectedHash: string, algorithm: string, iterations: number) {
  if (algorithm !== PASSWORD_ALGORITHM || iterations !== PASSWORD_ITERATIONS) return false;
  const derived = await hashPassword(password, pepper, salt, iterations);
  return safeEqual(derived.hash, expectedHash);
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

const RESERVED_USERNAMES = new Set(["admin", "api", "help", "mivo", "moderator", "official", "privacy", "safety", "security", "support", "system", "terms"]);
const COMMON_PASSWORDS = new Set(["1234567890", "password123", "qwerty12345", "indonesia123", "sayang12345"]);

export function usernameError(input: string) {
  const username = normalizeUsername(input);
  if (!/^[a-z0-9](?!.*[._]{2})[a-z0-9._]{1,22}[a-z0-9]$/.test(username)) return "Username harus 3–24 karakter dan hanya memakai huruf, angka, titik, atau garis bawah.";
  if (RESERVED_USERNAMES.has(username)) return "Username itu dicadangkan oleh MIVO.";
  return null;
}

export function passwordError(password: string, username = "") {
  if (password.length < 10 || password.length > 128) return "Gunakan password 10–128 karakter.";
  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized) || (username.length >= 3 && normalized.includes(username))) return "Password terlalu mudah ditebak. Gunakan frasa yang unik.";
  return null;
}

export function ageFromBirthDate(birthDate: string, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return -1;
  const [year, month, day] = birthDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return -1;
  let age = today.getUTCFullYear() - year;
  const beforeBirthday = today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isAdult(birthDate: string, today = new Date()) {
  const age = ageFromBirthDate(birthDate, today);
  return age >= 18 && age <= 120;
}

export function agePresentation(birthDate: string, visibility: "range" | "exact" | "hidden") {
  const age = ageFromBirthDate(birthDate);
  if (visibility === "hidden" || age < 18) return null;
  if (visibility === "exact") return `${age}`;
  const lower = Math.floor(age / 5) * 5;
  return `${lower}–${lower + 4}`;
}

export function sanitizeVibes(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter((value): value is string => typeof value === "string" && VIBE_IDS.has(value)))).slice(0, 5);
}

export function makeAlias(seed?: number) {
  const value = seed ?? crypto.getRandomValues(new Uint32Array(1))[0];
  return `${ALIAS_ADJECTIVES[value % ALIAS_ADJECTIVES.length]}${ALIAS_ANIMALS[Math.floor(value / ALIAS_ADJECTIVES.length) % ALIAS_ANIMALS.length]}`;
}

export function overlapScore(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.reduce((score, vibe) => score + (rightSet.has(vibe) ? 1 : 0), 0);
}

export type Plan = "FREE" | "PLUS" | "MAX";

export function canUseGenderFilter(plan: Plan, usedToday: number) {
  if (plan === "MAX") return { allowed: true, remaining: null };
  if (plan === "PLUS") return { allowed: usedToday < PLUS_DAILY_FILTERED_MATCHES, remaining: Math.max(0, PLUS_DAILY_FILTERED_MATCHES - usedToday) };
  return { allowed: false, remaining: 0 };
}

export function entitlementDate(date = new Date(), timeZone = "Asia/Jakarta") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export type RetentionChoice = "chat" | "24h" | "7d" | "keep";
const RETENTION_MS: Record<Exclude<RetentionChoice, "keep">, number> = { chat: 0, "24h": 86_400_000, "7d": 604_800_000 };

export function retentionDecision(left: RetentionChoice, right: RetentionChoice, endedAt = new Date()) {
  if (left === "keep" && right === "keep") return { connect: true, expiresAt: null };
  const leftMs = left === "keep" ? RETENTION_MS["7d"] : RETENTION_MS[left];
  const rightMs = right === "keep" ? RETENTION_MS["7d"] : RETENTION_MS[right];
  return { connect: false, expiresAt: new Date(endedAt.getTime() + Math.min(leftMs, rightMs)).toISOString() };
}

export function orderedPair(left: string, right: string) {
  return left < right ? [left, right] as const : [right, left] as const;
}

export function trustBand(score: number): "new" | "established" | "trusted" {
  if (score >= 40) return "trusted";
  if (score >= 10) return "established";
  return "new";
}

export function containsSuspiciousUrl(text: string) {
  const urls = text.match(/(?:https?:\/\/|www\.)\S+/gi) ?? [];
  return urls.some((url) => /(?:bit\.ly|tinyurl\.com|t\.me\/\+|wa\.me|\d{1,3}(?:\.\d{1,3}){3})/i.test(url));
}

export function selectIcebreaker(category: string) {
  const deck = ICEBREAKERS[category] ?? ICEBREAKERS.Random;
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % deck.length;
  return deck[index];
}

export function safeJsonArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
