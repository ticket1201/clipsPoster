import { createHmac, timingSafeEqual } from "node:crypto";
import { loadOptionalInstagramEnv } from "@clips-poster/config";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  if (!uuidPattern.test(clipId)) return Response.json({ error: "not found" }, { status: 404 });
  const credentials = loadOptionalInstagramEnv();
  const url = new URL(request.url);
  const expires = url.searchParams.get("expires");
  const signature = url.searchParams.get("signature");
  if (!credentials || !expires || !signature || !/^\d{10}$/.test(expires) || Number(expires) <= Date.now() / 1_000) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const expected = createHmac("sha256", credentials.TIKTOK_TOKEN_ENCRYPTION_KEY)
    .update(`${clipId}:${expires}`)
    .digest("base64url");
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const range = request.headers.get("range");
  const upstream = await fetch(`${API_URL}/clips/${encodeURIComponent(clipId)}/tiktok`, {
    ...(range ? { headers: { range } } : {}),
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) return Response.json({ error: "not found" }, { status: 404 });
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "video/mp4",
    "cache-control": "public, max-age=3600",
    "content-disposition": `inline; filename="${clipId}.mp4"`,
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  return new Response(upstream.body, { status: upstream.status, headers });
}
