// Gemini AI module — streaming article generation and 5W1H summaries
import { buildArticlePrompt, build5W1HPrompt } from "./prompts";

const GEMINI_MODEL = "gemini-2.5-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Post a payload to a Gemini API endpoint and return the raw Response.
 * For streaming endpoints alt=sse is appended to the query string.
 */
async function geminiFetch(
  endpoint: string,
  apiKey: string,
  body: object,
  isStream = false,
): Promise<Response> {
  const alt = isStream ? "&alt=sse" : "";
  const url = `${BASE_URL}/${GEMINI_MODEL}:${endpoint}?key=${apiKey}${alt}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

/**
 * Stream an AI-generated article from Gemini via SSE.
 *
 * Calls Gemini's streamGenerateContent endpoint with the article prompt,
 * parses the NDJSON response, and re-emits each text delta as a clean
 * SSE `data: {text}\n\n` line.  Sends `data: [DONE]\n\n` when finished.
 *
 * On error the thrown Error will be caught by the caller (router).
 */
export async function streamArticle(
  subtitle: string,
  rule?: string,
  apiKey?: string,
): Promise<ReadableStream<Uint8Array>> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const prompt = buildArticlePrompt(subtitle, rule);

  const response = await geminiFetch(
    "streamGenerateContent",
    apiKey,
    { contents: [{ parts: [{ text: prompt }] }] },
    true,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API responded with ${response.status}: ${errorText}`,
    );
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Process the Gemini NDJSON/SSE response in the background
  (async () => {
    try {
      const body = response.body;
      if (!body) {
        throw new Error("Gemini response body is empty");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on newlines — each line is a complete SSE data: entry
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete fragment for next iteration

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const jsonStr = trimmed.slice(6).trim();
          if (!jsonStr) continue;

          try {
            // Gemini returns an array of candidate objects
            const chunks: Array<{
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
              }>;
            }> = JSON.parse(jsonStr);

            for (const chunk of chunks) {
              const parts = chunk?.candidates?.[0]?.content?.parts;
              if (!parts) continue;
              for (const part of parts) {
                if (part.text) {
                  await writer.write(
                    encoder.encode(`data: ${part.text}\n\n`),
                  );
                }
              }
            }
          } catch {
            // Skip unparseable JSON fragments
          }
        }
      }

      // Signal end of stream
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gemini stream error";
      await writer.write(encoder.encode(`data: ERROR: ${msg}\n\n`));
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return readable;
}

/**
 * Generate a structured 5W1H (Who/What/When/Where/Why/How) summary for a
 * single chapter by calling the non-streaming Gemini generateContent
 * endpoint.
 *
 * Parses the JSON response and returns a typed object.  If parsing fails
 * a fallback object with Chinese error messages is returned so the caller
 * never has to handle a parse error.
 */
export async function generate5W1H(
  chapter: string,
  fullText: string,
  apiKey?: string,
): Promise<{
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const prompt = build5W1HPrompt(chapter, fullText);

  const response = await geminiFetch(
    "generateContent",
    apiKey,
    { contents: [{ parts: [{ text: prompt }] }] },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API responded with ${response.status}: ${errorText}`,
    );
  }

  const data: unknown = await response.json();
  const candidate = (data as Record<string, unknown>)?.candidates as
    | Array<Record<string, unknown>>
    | undefined;
  const content = candidate?.[0]?.content as
    | Record<string, unknown>
    | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  const text = parts?.[0]?.text as string | undefined;

  if (!text) {
    throw new Error("Gemini returned an empty response for 5W1H generation");
  }

  // Attempt to parse JSON from the response
  const parsed = tryParseJSON(text);
  if (parsed && isValid5W1H(parsed)) {
    return parsed;
  }

  // Return a fallback so the API never 500s on parsing
  return {
    who: "解析失败",
    what: "无法从 AI 响应中提取结构化信息",
    when: "解析失败",
    where: "解析失败",
    why: "解析失败",
    how: "解析失败",
  };
}

/**
 * Try to extract a JSON object from Gemini's text response.
 * Handles bare JSON, markdown-fenced JSON, and raw embedded objects.
 */
function tryParseJSON(
  text: string,
): Record<string, unknown> | null {
  // Bare JSON
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // fall through
  }

  // Markdown-fenced ```json ... ```
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // fall through
    }
  }

  // Look for a JSON object embedded in free text
  const embedded = text.match(/\{[\s\S]*"who"[\s\S]*"what"[\s\S]*"why"[\s\S]*"how"[\s\S]*?\}/);
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded[0]);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // fall through
    }
  }

  return null;
}

/** Type guard for a parsed 5W1H object. */
function isValid5W1H(
  obj: Record<string, unknown>,
): obj is {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
} {
  return (
    typeof obj.who === "string" &&
    typeof obj.what === "string" &&
    typeof obj.when === "string" &&
    typeof obj.where === "string" &&
    typeof obj.why === "string" &&
    typeof obj.how === "string"
  );
}
