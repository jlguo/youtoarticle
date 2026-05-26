// Request router — matches API paths, delegates to handlers
// Static assets in public/ are auto-served by the platform via [assets] config

import { extractVideoId, fetchSubtitlesWithFallback } from "./youtube";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEnv(raw: Record<string, unknown>): Env {
  return raw as unknown as Env;
}

export async function handleRequest(
  request: Request,
  rawEnv: Record<string, unknown>,
  _ctx: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders() },
    });
  }

  // POST /api/generate — SSE streaming article generation
  if (request.method === "POST" && pathname === "/api/generate") {
    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      if (!isRecord(body)) {
        return jsonResponse({ error: "Request body must be a JSON object" }, 400);
      }

      const youtubeUrl = typeof body.youtubeUrl === "string" ? body.youtubeUrl : undefined;
      const rule = typeof body.rule === "string" ? body.rule : undefined;

      if (!youtubeUrl) {
        return jsonResponse(
          { error: "Missing required field: youtubeUrl" },
          400,
        );
      }

      // Validate and extract video ID
      const videoId = extractVideoId(youtubeUrl);
      if (!videoId) {
        return jsonResponse(
          { error: "Invalid YouTube URL format. Please provide a valid youtube.com or youtu.be link." },
          400,
        );
      }

      // Fetch subtitles with full fallback chain
      const env = toEnv(rawEnv);
      const subtitles = await fetchSubtitlesWithFallback(videoId, env);

      // For now, return subtitles as JSON (Gemini streaming will be added later)
      return jsonResponse({ videoId, subtitles });
    } catch (e) {
      const message = e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/5w1h — chapter summary
  if (request.method === "POST" && pathname === "/api/5w1h") {
    return jsonResponse({ error: "5W1H not yet implemented" }, 501);
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
