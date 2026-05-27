import { extractVideoId, fetchSubtitlesWithFallback } from "./youtube";
import { streamArticle as geminiStreamArticle, generate5W1H as gemini5W1H } from "./gemini";
import { streamArticle as deepseekStreamArticle, generate5W1H as deepseek5W1H } from "./deepseek";
import {
  ROUTE_GENERATE,
  ROUTE_5W1H,
  CORS_ALLOW_ORIGIN,
  CORS_ALLOW_METHODS,
  CORS_ALLOW_HEADERS,
  PROVIDER_GEMINI,
  PROVIDER_DEEPSEEK,
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

type AIProvider = typeof PROVIDER_GEMINI | typeof PROVIDER_DEEPSEEK;

function getProvider(request: Request, env: Env): AIProvider {
  const url = new URL(request.url);
  const param = url.searchParams.get("provider");
  if (param === PROVIDER_DEEPSEEK && env.DEEPSEEK_API_KEY) {
    return PROVIDER_DEEPSEEK;
  }
  return PROVIDER_GEMINI;
}

function getAPIKey(provider: AIProvider, env: Env): string {
  if (provider === PROVIDER_DEEPSEEK) {
    return env.DEEPSEEK_API_KEY!;
  }
  return env.GEMINI_API_KEY;
}

export async function handleRequest(
  request: Request,
  rawEnv: Record<string, unknown>,
  _ctx: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders() },
    });
  }

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

      const env = toEnv(rawEnv);
      const { text: subtitle } = await fetchSubtitlesWithFallback(videoId, env);

      const rule =
        typeof body.rule === "string" ? body.rule : undefined;
      const provider = getProvider(request, env);
      const apiKey = getAPIKey(provider, env);

      if (provider === PROVIDER_DEEPSEEK) {
        return await deepseekStreamArticle(subtitle, rule, apiKey);
      }
      return await geminiStreamArticle(subtitle, rule, apiKey);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  if (request.method === "POST" && pathname === ROUTE_5W1H) {
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

      const chapter =
        typeof body.chapter === "string" ? body.chapter : undefined;
      const fullText =
        typeof body.fullText === "string" ? body.fullText : undefined;

      if (!chapter || !fullText) {
        return jsonResponse(
          { error: "Missing required field: chapter or fullText" },
          400,
        );
      }

      const env = toEnv(rawEnv);
      const provider = getProvider(request, env);
      const apiKey = getAPIKey(provider, env);

      if (provider === PROVIDER_DEEPSEEK) {
        return await deepseek5W1H(chapter, fullText, apiKey);
      }
      return await gemini5W1H(chapter, fullText, apiKey);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
