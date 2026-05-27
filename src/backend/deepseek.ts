import { buildArticleMessages, build5W1HMessages } from "./prompts";
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  DEEPSEEK_ARTICLE_TEMPERATURE,
  DEEPSEEK_5W1H_TEMPERATURE,
  DEEPSEEK_5W1H_MAX_TOKENS,
} from "./config";
import { corsResponse, errorResponse } from "./api-client";
import { jsonResponse } from "./response";

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

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return errorResponse(`DeepSeek API error (HTTP ${res.status}): ${err.slice(0, 300)}`, res.status);
  }

  const deepseekJson = await res.json() as Record<string, unknown>;
  const rawText = (deepseekJson as any)?.choices?.[0]?.message?.content as string | undefined;
  if (!rawText) {
    return jsonResponse({ error: "DeepSeek returned empty response" }, 500);
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return jsonResponse({ error: "No JSON found in DeepSeek response" }, 500);
  }

  try {
    return jsonResponse(JSON.parse(jsonMatch[0]));
  } catch {
    return jsonResponse({ error: "Failed to parse 5W1H JSON" }, 500);
  }
}
