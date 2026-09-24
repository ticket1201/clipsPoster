import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
type PublishingPlatform = "TIKTOK" | "YOUTUBE" | "INSTAGRAM";
const publishingPlatforms = new Set<PublishingPlatform>(["TIKTOK", "YOUTUBE", "INSTAGRAM"]);
const isAlreadyCompleted = (message: string) => message.includes("already uploaded") || message.includes("already published");

export async function GET(request: NextRequest) {
  const publicationId = request.nextUrl.searchParams.get("publicationId");
  if (!publicationId) return NextResponse.json({ error: "publicationId is required" }, { status: 400 });
  const response = await fetch(`${API_URL}/publications/${encodeURIComponent(publicationId)}/status`, { cache: "no-store" });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { clipId?: unknown; platform?: unknown; title?: unknown; repeat?: unknown } | null;
  if (typeof body?.clipId !== "string") {
    return NextResponse.json({ error: "clipId is required" }, { status: 400 });
  }
  if (body.platform !== undefined && (
    typeof body.platform !== "string"
    || !publishingPlatforms.has(body.platform as PublishingPlatform)
  )) {
    return NextResponse.json({ error: "Invalid publishing platform" }, { status: 400 });
  }
  if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length === 0 || body.title.length > 100)) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }
  if (body.repeat !== undefined && typeof body.repeat !== "boolean") {
    return NextResponse.json({ error: "Invalid repeat flag" }, { status: 400 });
  }
  const clipId = encodeURIComponent(body.clipId);
  const targets = [
    { platform: "TIKTOK", path: `/clips/${clipId}/draft/tiktok` },
    { platform: "YOUTUBE", path: `/clips/${clipId}/publish/youtube` },
    { platform: "INSTAGRAM", path: `/clips/${clipId}/publish/instagram` },
  ] as const;
  const selectedTargets = body.platform
    ? targets.filter((target) => target.platform === body.platform)
    : targets;
  const results = await Promise.all(selectedTargets.map(async (target) => {
    const response = await fetch(`${API_URL}${target.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true, ...(typeof body.title === "string" ? { title: body.title.trim() } : {}), ...(body.repeat === true ? { repeat: true } : {}) }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as {
      id?: string;
      status?: string;
      publications?: Array<{ id: string; status?: string }>;
      error?: string;
      warning?: string;
    };
    return { ...target, response, result };
  }));
  const publications = results.flatMap(({ platform, response, result }) => {
    if (!response.ok) return [];
    if (result.publications?.length) {
      return result.publications.map((publication) => ({
        id: publication.id,
        platform,
        status: publication.status ?? "PROCESSING",
      }));
    }
    return result.id ? [{ id: result.id, platform, status: result.status ?? "PROCESSING" }] : [];
  });
  const failures = results.flatMap(({ platform, response, result }) => {
    if (!response.ok && result.error && !isAlreadyCompleted(result.error) && (body.platform || !result.error.includes("not assigned"))) {
      return [{ platform, error: result.error }];
    }
    return result.warning ? [{ platform, error: result.warning }] : [];
  });
  if (publications.length === 0) {
    const firstFailure = failures[0];
    const failedResult = firstFailure
      ? results.find(({ platform }) => platform === firstFailure.platform)
      : undefined;
    return NextResponse.json({
      error: firstFailure
        ? `${firstFailure.platform}: ${firstFailure.error}`
        : "Нет привязанных площадок",
      failures,
    }, { status: failedResult?.response.status ?? 409 });
  }
  const warning = failures.map(({ platform, error }) => `${platform}: ${error}`).join("; ") || undefined;
  return NextResponse.json({ publications, failures, warning }, { status: 202 });
}
