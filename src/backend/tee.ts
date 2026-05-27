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

// Single-reader stream wrapper: passes data through while accumulating article text.
// Uses one reader to avoid "locked to a reader" errors — no tee() needed.
export function teeAndSaveArticle(
  body: ReadableStream,
  sessionId: string,
  env: Env,
  subtitleSnippet: string,
  rule: string | undefined,
): ReadableStream {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  let lineStart = 0;

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Flush remaining decoder bytes and process any new lines
          buffer += decoder.decode();
          let idx: number;
          while ((idx = buffer.indexOf("\n", lineStart)) !== -1) {
            const line = buffer.slice(lineStart, idx);
            lineStart = idx + 1;
            const text = parseSSELine(line);
            if (text) fullText += text;
          }

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
          controller.close();
          return;
        }

        controller.enqueue(value);

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n", lineStart)) !== -1) {
          const line = buffer.slice(lineStart, newlineIdx);
          lineStart = newlineIdx + 1;
          const text = parseSSELine(line);
          if (text) fullText += text;
        }

        if (lineStart > 4096) {
          buffer = buffer.slice(lineStart);
          lineStart = 0;
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
