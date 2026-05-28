import { ARTICLE_KV_PREFIX, ARTICLE_TTL_SECONDS } from "./config";

interface SessionData {
  videoTitle: string;
  ruleUsed: string | null;
  fullText: string;
}

function parseSSELine(line: string): string | null {
  if (line.slice(0, 6) !== "data: ") return null;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(jsonStr); } catch { return null; }

  const geminiText = (parsed as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof geminiText === "string") return geminiText;

  const deepseekText = (parsed as any)?.choices?.[0]?.delta?.content;
  if (typeof deepseekText === "string") return deepseekText;

  return null;
}

function extractTextFromSSE(raw: string): string {
  const lines = raw.split("\n");
  let text = "";
  for (const line of lines) {
    const t = parseSSELine(line.trim());
    if (t) text += t;
  }
  return text;
}

// Pass-through stream wrapper: relays data to client immediately.
// Accumulates raw bytes and parses/decode ONLY once at the end to save CPU.
export function teeAndSaveArticle(
  body: ReadableStream,
  sessionId: string,
  env: Env,
  subtitleSnippet: string,
  rule: string | undefined,
): ReadableStream {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // All chunks received — decode once and parse once
          if (chunks.length > 0) {
            const totalLen = chunks.reduce((s, c) => s + c.length, 0);
            const merged = new Uint8Array(totalLen);
            let offset = 0;
            for (const c of chunks) {
              merged.set(c, offset);
              offset += c.length;
            }
            const rawText = decoder.decode(merged);
            const fullText = extractTextFromSSE(rawText);

            if (fullText) {
              const data: SessionData = {
                videoTitle: subtitleSnippet.slice(0, 200),
                ruleUsed: rule || null,
                fullText,
              };
              await env.SESSION_KV.put(
                `${ARTICLE_KV_PREFIX}${sessionId}`,
                JSON.stringify(data),
                { expirationTtl: ARTICLE_TTL_SECONDS },
              );
              console.log(`[article] Saved article for session ${sessionId} (${fullText.length} chars)`);
            }
          }
          controller.close();
          return;
        }

        // Pass through to client immediately — zero CPU work
        controller.enqueue(value);
        chunks.push(value);
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
