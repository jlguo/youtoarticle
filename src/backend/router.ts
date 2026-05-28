import { extractVideoId, fetchSubtitlesWithFallback } from "./youtube";
import { streamArticle as geminiStreamArticle, generate5W1H as gemini5W1H } from "./gemini";
import { streamArticle as deepseekStreamArticle, generate5W1H as deepseek5W1H } from "./deepseek";
import {
  ROUTE_GENERATE,
  ROUTE_5W1H,
  PROVIDER_GEMINI,
  PROVIDER_DEEPSEEK,
  GEMINI_MODEL,
  GEMINI_MODEL_LITE,
  ARTICLE_KV_PREFIX,
  SUBTITLE_MAX_CHARS,
} from "./config";
import { jsonResponse, corsHeaders } from "./response";
import { parseJSONBody, getStringField } from "./validation";
import { teeAndSaveArticle } from "./tee";
import { detectLang, t } from "./locale";

type AIProvider = typeof PROVIDER_GEMINI | typeof PROVIDER_DEEPSEEK;

function getProvider(request: Request, env: Env): AIProvider {
  const url = new URL(request.url);
  const model = url.searchParams.get("model") || "";
  if (model.startsWith("deepseek") && env.DEEPSEEK_API_KEY) {
    return PROVIDER_DEEPSEEK;
  }
  return PROVIDER_GEMINI;
}

function getModel(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("model") || GEMINI_MODEL;
}

function getAPIKey(provider: AIProvider, env: Env): string {
  return provider === PROVIDER_DEEPSEEK ? env.DEEPSEEK_API_KEY! : env.GEMINI_API_KEY;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const lang = detectLang(request);
  const _ = t(lang);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...corsHeaders() } });
  }

  if (request.method === "POST" && pathname === ROUTE_GENERATE) {
    try {
      const body = await parseJSONBody(request, lang);
      if (body instanceof Response) return body;

      const youtubeUrl = getStringField(body, "youtubeUrl");
      if (!youtubeUrl) {
        return jsonResponse({ error: _.missingField("youtubeUrl") }, 400);
      }

      const videoId = extractVideoId(youtubeUrl);
      if (!videoId) {
        return jsonResponse({ error: _.invalidYouTubeURL }, 400);
      }

      const { text: subtitle, fromFallback } = await fetchSubtitlesWithFallback(videoId, env);
      const rule = getStringField(body, "rule");

      // Truncate long subtitles to avoid CPU/memory limits and excessive AI reasoning output
      const truncatedSubtitle = subtitle.length > SUBTITLE_MAX_CHARS
        ? subtitle.slice(0, SUBTITLE_MAX_CHARS)
        : subtitle;
      if (subtitle.length > SUBTITLE_MAX_CHARS) {
        console.log(`[router] Truncated subtitle from ${subtitle.length} to ${SUBTITLE_MAX_CHARS} chars`);
      }

      const provider = getProvider(request, env);
      const apiKey = getAPIKey(provider, env);

      let aiResponse: Response;
      if (provider === PROVIDER_DEEPSEEK) {
        aiResponse = await deepseekStreamArticle(truncatedSubtitle, rule, apiKey);
      } else {
        aiResponse = await geminiStreamArticle(truncatedSubtitle, rule, apiKey, getModel(request));
      }

      if (!aiResponse.ok || !aiResponse.body) return aiResponse;

      const sessionId = crypto.randomUUID();
      const teeBody = teeAndSaveArticle(aiResponse.body, sessionId, env, truncatedSubtitle, rule);

      return new Response(teeBody, {
        status: aiResponse.status,
        headers: {
          ...Object.fromEntries(aiResponse.headers.entries()),
          "X-Session-Id": sessionId,
          "X-From-Fallback": String(fromFallback),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : _.unexpectedError;
      return jsonResponse({ error: message }, 500);
    }
  }

  if (request.method === "POST" && pathname === ROUTE_5W1H) {
    try {
      const body = await parseJSONBody(request, lang);
      if (body instanceof Response) return body;

      const sessionId = getStringField(body, "sessionId");
      const chapter = getStringField(body, "chapter");
      if (!sessionId || !chapter) {
        const missing = !sessionId ? "sessionId" : "chapter";
        return jsonResponse({ error: _.missingField(missing) }, 400);
      }

      const stored = await env.SESSION_KV.get(`${ARTICLE_KV_PREFIX}${sessionId}`);
      if (!stored) {
        return jsonResponse({ error: _.sessionNotFound }, 404);
      }

      let fullText: string;
      try {
        const data = JSON.parse(stored);
        fullText = data.fullText || data;
      } catch {
        fullText = stored;
      }

      const provider = getProvider(request, env);
      const apiKey = getAPIKey(provider, env);

      if (provider === PROVIDER_DEEPSEEK) {
        return await deepseek5W1H(chapter, fullText, apiKey);
      }
      return await gemini5W1H(chapter, fullText, apiKey, getModel(request));
    } catch (e) {
      const message = e instanceof Error ? e.message : _.unexpectedError;
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: _.notFound }, 404);
}
