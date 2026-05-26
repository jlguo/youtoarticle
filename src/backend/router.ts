// Request router — matches API paths, delegates to handlers
// Static assets in public/ are auto-served by the platform via [assets] config

import { extractVideoId, fetchSubtitlesWithFallback } from "./youtube";
import { streamArticle as geminiStreamArticle, generate5W1H as gemini5W1H } from "./gemini";
import { streamArticle as deepseekStreamArticle, generate5W1H as deepseek5W1H } from "./deepseek";
import { saveSession, getSession } from "./session";

function getStreamArticle(env: Env) {
  if (env.DEEPSEEK_API_KEY) return deepseekStreamArticle;
  return geminiStreamArticle;
}

function getGenerate5W1H(env: Env) {
  if (env.DEEPSEEK_API_KEY) return deepseek5W1H;
  return gemini5W1H;
}

function getAIProviderName(env: Env): string {
  if (env.DEEPSEEK_API_KEY) return "deepseek";
  return "gemini";
}

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

/**
 * Extract chapter titles from article text.
 * Each line starting with `## ` is treated as a chapter heading.
 */
function extractChapters(text: string): string[] {
  const chapters: string[] = [];
  const regex = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    chapters.push(match[1].trim());
  }
  return chapters;
}

/**
 * Generate a UUID v4 string using the Web Crypto API.
 */
function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set version 4 (0100 in binary) and variant (10xx)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
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

      const youtubeUrl =
        typeof body.youtubeUrl === "string" ? body.youtubeUrl : undefined;
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
          {
            error:
              "无效的 YouTube 链接格式。请提供有效的 youtube.com 或 youtu.be 链接。",
          },
          400,
        );
      }

      // Fetch subtitles with full fallback chain
      const env = toEnv(rawEnv);
      const subtitles = await fetchSubtitlesWithFallback(videoId, env);

      // Generate a session UUID for KV storage
      const sessionId = generateUUID();

      // Call AI streaming (DeepSeek or Gemini)
      const streamFn = getStreamArticle(env);
      const providerName = getAIProviderName(env);
      const aiKey = providerName === "deepseek" ? env.DEEPSEEK_API_KEY! : env.GEMINI_API_KEY;
      const aiStream = await streamFn(
        subtitles,
        rule,
        aiKey,
      );

      // Create a transform stream that:
      //   1. Passes SSE chunks through to the HTTP response
      //   2. Accumulates the full article text (by parsing SSE data lines)
      //   3. Saves the session to KV when the stream ends
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = aiStream.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let fullText = "";

      async function pipeStream() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });

            // Extract actual text from SSE for accumulation
            const dataPrefix = "data: ";
            const dataSuffix = "\n\n";
            if (
              chunk.startsWith(dataPrefix) &&
              chunk.endsWith(dataSuffix)
            ) {
              const data = chunk.slice(
                dataPrefix.length,
                -dataSuffix.length,
              );
              if (data !== "[DONE]" && !data.startsWith("ERROR: ")) {
                fullText += data;
              }
            }

            // Forward the chunk to the HTTP response
            await writer.write(value);
          }

          // Save session to KV (fire-and-forget — log failures but don't crash)
          if (fullText) {
            try {
              const chapters = extractChapters(fullText);
              await saveSession(env.SESSION_KV, sessionId, {
                fullText,
                chapters,
                subtitle: subtitles,
              });
            } catch (kvErr) {
              console.error("[router] Failed to save session to KV:", kvErr);
            }
          }
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : "Stream processing error";
          try {
            await writer.write(
              encoder.encode(`data: ERROR: ${msg}\n\n`),
            );
          } catch {
            // writer may already be errored
          }
        } finally {
          try {
            await writer.close();
          } catch {
            // ignore close errors
          }
        }
      }

      // Start streaming in background (don't await)
      pipeStream();

      // Return the SSE response immediately
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Session-Id": sessionId,
          ...corsHeaders(),
        },
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  // GET /api/test-stream — bypass subtitle extraction, test AI provider directly
  if (request.method === "GET" && pathname === "/api/test-stream") {
    try {
    const env = toEnv(rawEnv);
    const testSubtitles = "人工智能正在改变世界。AI技术取得了惊人的进步。";
    const sessionId = generateUUID();
    const streamFn = getStreamArticle(env);
    const providerName = getAIProviderName(env);
    const aiKey = providerName === "deepseek" ? env.DEEPSEEK_API_KEY! : env.GEMINI_API_KEY;
    const aiStream = await streamFn(testSubtitles, "简短回答，50字以内", aiKey);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = aiStream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let fullText = "";

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk.startsWith("data: ") && chunk.endsWith("\n\n")) {
            const data = chunk.slice(6, -2);
            if (data !== "[DONE]" && !data.startsWith("ERROR: ")) fullText += data;
          }
          await writer.write(value);
        }
        if (fullText) {
          const chapters = extractChapters(fullText);
          await saveSession(env.SESSION_KV, sessionId, { fullText, chapters, subtitle: testSubtitles });
        }
      } catch (e) {
        await writer.write(encoder.encode(`data: ERROR: ${e instanceof Error ? e.message : "error"}\n\n`));
      } finally {
        await writer.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Session-Id": sessionId,
        ...corsHeaders(),
      },
    });
    } catch (e) {
      const message = e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/5w1h — chapter summary
  if (request.method === "POST" && pathname === "/api/5w1h") {
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

      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : undefined;
      const chapter =
        typeof body.chapter === "string" ? body.chapter : undefined;

      if (!sessionId || !chapter) {
        return jsonResponse(
          {
            error:
              "Missing required fields: sessionId and chapter are both required",
          },
          400,
        );
      }

      const env = toEnv(rawEnv);
      const session = await getSession(env.SESSION_KV, sessionId);

      if (!session) {
        return jsonResponse(
          {
            error:
              "Session not found. The session may have expired or the sessionId is invalid.",
          },
          404,
        );
      }

      const genFn = getGenerate5W1H(env);
      const providerName = getAIProviderName(env);
      const aiKey = providerName === "deepseek" ? env.DEEPSEEK_API_KEY! : env.GEMINI_API_KEY;
      const result = await genFn(
        chapter,
        session.fullText,
        aiKey,
      );

      return jsonResponse(result);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "An unexpected error occurred";
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
