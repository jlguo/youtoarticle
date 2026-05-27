import { jsonResponse } from "./response";
import { t, type Lang } from "./locale";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseJSONBody(request: Request, lang: Lang): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: t(lang).invalidJSON }, 400);
  }
  if (!isRecord(body)) {
    return jsonResponse({ error: t(lang).bodyNotObject }, 400);
  }
  return body;
}

export function getStringField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
