import { buildArticleMessages, build5W1HMessages } from "./prompts";
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  DEEPSEEK_ARTICLE_TEMPERATURE,
  DEEPSEEK_5W1H_TEMPERATURE,
  DEEPSEEK_5W1H_MAX_TOKENS,
} from "./config";

function corsResponse(body: ReadableStream | null, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": status === 200 && contentType === "text/event-stream" ? "no-cache" : "",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return corsResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: message })));
        controller.close();
      },
    }),
    "application/json",
    status,
  );
}

export async function streamArticle(subtitle: string, rule: string | undefined, apiKey: string): Promise<Response> {
  const messages = buildArticleMessages(subtitle, rule);
  const res = await fetch(DEEPSEEK_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      stream: true,
      temperature: DEEPSEEK_ARTICLE_TEMPERATURE,
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    return errorResponse(`DeepSeek API error (HTTP ${res.status}): ${err.slice(0, 300)}`, res.status);
  }

  return corsResponse(res.body, "text/event-stream");
}

export async function generate5W1H(chapter: string, fullText: string, apiKey: string): Promise<Response> {
  const messages = build5W1HMessages(chapter, fullText);
  const res = await fetch(DEEPSEEK_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      stream: false,
      temperature: DEEPSEEK_5W1H_TEMPERATURE,
      max_tokens: DEEPSEEK_5W1H_MAX_TOKENS,
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    return errorResponse(`DeepSeek API error (HTTP ${res.status}): ${err.slice(0, 300)}`, res.status);
  }

  return corsResponse(res.body, "application/json");
}
