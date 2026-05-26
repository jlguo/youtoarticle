// Request router — subtitle extraction endpoint
// Static assets in public/ are auto-served by the platform via [assets] config

import { extractVideoId, fetchSubtitlesWithFallback } from "./youtube";
import {
  ROUTE_GENERATE,
  CORS_ALLOW_ORIGIN,
  CORS_ALLOW_METHODS,
  CORS_ALLOW_HEADERS,
} from "./config";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": CORS_ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
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

  // POST /api/generate — extract YouTube subtitles, return JSON
  if (request.method === "POST" && pathname === ROUTE_GENERATE) {
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

      const youtubeUrl =
        typeof body.youtubeUrl === "string" ? body.youtubeUrl : undefined;

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
          {
            error:
              "无效的 YouTube 链接格式。请提供有效的 youtube.com 或 youtu.be 链接。",
          },
          400,
        );
      }

      // Fetch subtitles with full fallback chain
      const env = toEnv(rawEnv);
      const { text: subtitle, fromFallback } = await fetchSubtitlesWithFallback(videoId, env);

      return jsonResponse({ subtitle, videoId, fromFallback }, 200);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
