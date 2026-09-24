const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function PATCH(request: Request) {
  const body = await request.json() as {
    source?: "TWITCH" | "KICK";
    channelId?: string;
    crop?: { x: number; y: number; width: number; height: number } | null;
    webcamOnly?: boolean;
  };
  if (!body.channelId || (body.source !== "TWITCH" && body.source !== "KICK")) {
    return Response.json({ error: "invalid source channel" }, { status: 400 });
  }
  const sourcePath = body.source === "TWITCH" ? "twitch" : "kick";
  const response = await fetch(
    `${API_URL}/${sourcePath}/channels/${encodeURIComponent(body.channelId)}/webcam`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ crop: body.crop ?? null, webcamOnly: body.webcamOnly === true }),
    },
  );
  const result = await response.json().catch(() => ({ error: "Unable to save webcam crop" }));
  return Response.json(result, { status: response.status });
}
