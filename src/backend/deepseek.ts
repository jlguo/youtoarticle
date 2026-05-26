// DeepSeek AI module — streaming article generation and 5W1H summaries
// Uses OpenAI-compatible chat completions API
import { buildArticleMessages, build5W1HMessages } from "./prompts";

const MODEL = "deepseek-chat";
const BASE_URL = "https://api.deepseek.com/v1/chat/completions";

/**
 * Stream an AI-generated article from DeepSeek via SSE.
 *
 * Calls the chat completions endpoint with stream: true, parses the
 * OpenAI-compatible SSE chunks, and re-emits each text delta as a clean
 * SSE `data: {text}\n\n` line. Sends `data: [DONE]\n\n` when finished.
 */
export async function streamArticle(
  subtitle: string,
  rule?: string,
  apiKey?: string,
): Promise<ReadableStream<Uint8Array>> {
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const messages = buildArticleMessages(subtitle, rule);

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `DeepSeek API responded with ${response.status}: ${errorText}`,
    );
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      const body = response.body;
      if (!body) {
        throw new Error("DeepSeek response body is empty");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneSent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const jsonStr = trimmed.slice(6).trim();
          if (!jsonStr) continue;
          if (jsonStr === "[DONE]") {
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            doneSent = true;
            continue;
          }

          try {
            const chunk: {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            } = JSON.parse(jsonStr);

            const delta = chunk?.choices?.[0]?.delta;
            if (delta?.content) {
              // SSE payloads must not contain \n — it breaks the \n\n delimiter.
              // Split on \n and emit each line as a separate data: message.
              // Empty lines from \n\n are preserved as data: (empty payload).
              const segments = delta.content.split('\n');
              for (let s = 0; s < segments.length; s++) {
                if (s > 0) {
                  await writer.write(encoder.encode('data: \n\n'));
                }
                if (segments[s]) {
                  await writer.write(encoder.encode(`data: ${segments[s]}\n\n`));
                }
              }
            }
          } catch {
            // Skip unparseable JSON fragments
          }
        }
      }

      if (!doneSent) {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DeepSeek stream error";
      await writer.write(encoder.encode(`data: ERROR: ${msg}\n\n`));
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return readable;
}

/**
 * Generate a structured 5W1H (Who/What/When/Where/Why/How) summary for a
 * single chapter by calling the non-streaming DeepSeek chat completions endpoint.
 *
 * Parses the JSON response and returns a typed object. If parsing fails
 * a fallback object with Chinese error messages is returned.
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
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const messages = build5W1HMessages(chapter, fullText);

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      temperature: 0.3,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `DeepSeek API responded with ${response.status}: ${errorText}`,
    );
  }

  const data: Record<string, unknown> =
    await response.json() as Record<string, unknown>;
  const choices = data?.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  const text = choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("DeepSeek returned an empty response for 5W1H generation");
  }

  const parsed = tryParseJSON(text);
  if (parsed && isValid5W1H(parsed)) {
    return parsed;
  }

  return {
    who: "解析失败",
    what: "无法从 AI 响应中提取结构化信息",
    when: "解析失败",
    where: "解析失败",
    why: "解析失败",
    how: "解析失败",
  };
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // fall through
  }

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // fall through
    }
  }

  const embedded = text.match(
    /\{[\s\S]*"who"[\s\S]*"what"[\s\S]*"why"[\s\S]*"how"[\s\S]*?\}/,
  );
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
