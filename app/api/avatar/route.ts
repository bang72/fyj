import { getBucket, getDatabase } from "@/lib/database";
import { randomId } from "@/lib/mivo-core";
import { assertSameOrigin, consumeRateLimit, jsonError, requireViewer } from "@/lib/server-foundation";

function detectedType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: "image/png", extension: "png" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { type: "image/webp", extension: "webp" };
  return null;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const viewer = await requireViewer(request);
    if (!(await consumeRateLimit(request, "avatar_upload", 10, 3600, viewer.id))) return Response.json({ error: "Terlalu banyak foto diunggah. Coba lagi nanti." }, { status: 429 });
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 2_600_000) return Response.json({ error: "Foto maksimal 2,5 MB." }, { status: 413 });
    const data = await request.formData();
    const file = data.get("photo");
    if (!(file instanceof File) || file.size === 0 || file.size > 2_500_000) return Response.json({ error: "Pilih foto JPG, PNG, atau WebP maksimal 2,5 MB." }, { status: 400 });
    const buffer = await file.arrayBuffer();
    const format = detectedType(new Uint8Array(buffer).slice(0, 16));
    if (!format) return Response.json({ error: "Format foto tidak didukung." }, { status: 415 });
    const key = `avatars/${viewer.id}/${randomId("photo")}.${format.extension}`;
    await getBucket().put(key, buffer, { httpMetadata: { contentType: format.type }, customMetadata: { owner: viewer.id } });
    await getDatabase().prepare("UPDATE identities SET photo_key = ?, updated_at = ? WHERE user_id = ?").bind(key, new Date().toISOString(), viewer.id).run();
    if (viewer.photo_key && viewer.photo_key !== key) await getBucket().delete(viewer.photo_key).catch(() => undefined);
    return Response.json({ ok: true, photoUrl: `/api/avatar/${viewer.public_id}` }, { status: 201 });
  } catch (error) {
    console.error("avatar_upload_failed", error);
    if (error instanceof Error && error.message === "MIVO_STORAGE_UNAVAILABLE") return Response.json({ error: "Penyimpanan foto belum dikonfigurasi." }, { status: 503 });
    return jsonError(error);
  }
}
