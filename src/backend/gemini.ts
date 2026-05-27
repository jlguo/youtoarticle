import { buildArticlePrompt, build5W1HPrompt } from "./prompts";
import { GEMINI_BASE_URL_STREAM, GEMINI_BASE_URL_NONSTREAM } from "./config";
import { corsResponse, errorResponse } from "./api-client";
import { jsonResponse } from "./response";

export async function streamArticle(subtitle: string, rule: string | undefined, apiKey: string): Promise<Response> {
  const prompt = buildArticlePrompt(subtitle, rule);
  const res = await fetch(`${GEMINI_BASE_URL_STREAM}?alt=sse&key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    return errorResponse(`Gemini API error (HTTP ${res.status}): ${err.slice(0, 300)}`, res.status);
  }

  return corsResponse(res.body, "text/event-stream");
}

export async function generate5W1H(chapter: string, fullText: string, apiKey: string): Promise<Response> {
  const prompt = build5W1HPrompt(chapter, fullText);
  const res = await fetch(`${GEMINI_BASE_URL_NONSTREAM}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return errorResponse(`Gemini API error (HTTP ${res.status}): ${err.slice(0, 300)}`, res.status);
  }

  const geminiJson = await res.json() as Record<string, unknown>;
  const rawText = (geminiJson as any)?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
  if (!rawText) {
    return jsonResponse({ error: "Gemini returned empty response" }, 500);
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return jsonResponse({ error: "No JSON found in Gemini response" }, 500);
  }

  try {
    return jsonResponse(JSON.parse(jsonMatch[0]));
  } catch {
    return jsonResponse({ error: "Failed to parse 5W1H JSON" }, 500);
  }
}
