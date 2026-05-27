import { describe, it, expect, vi, beforeEach } from "vitest";
import { teeAndSaveArticle } from "../backend/tee";

function createSSEStream(chunks: string[]): ReadableStream {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function createMockEnv(): Env {
  return {
    SESSION_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    } as unknown as KVNamespace,
    GEMINI_API_KEY: "test-gemini-key",
  };
}

async function readStreamToEnd(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

describe("teeAndSaveArticle", () => {
  let env: Env;
  let kvPut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env = createMockEnv();
    kvPut = env.SESSION_KV.put as ReturnType<typeof vi.fn>;
  });

  it("returns a readable stream that produces the same data (no double-reader error)", async () => {
    const input = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
    ]);

    const output = teeAndSaveArticle(input, "session-1", env, "test video", undefined);

    // Must NOT throw "locked to a reader"
    const result = await readStreamToEnd(output);
    expect(result).toContain("Hello");
  });

  it("accumulates Gemini SSE text and saves to KV after stream ends", async () => {
    const input = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"First "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"sentence."}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const output = teeAndSaveArticle(input, "session-1", env, "test", undefined);

    // Read the output stream to completion (triggers background KV save)
    await readStreamToEnd(output);

    // Wait for the async KV save to complete
    await vi.waitFor(
      () => {
        expect(kvPut).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const [key, value] = kvPut.mock.calls[0];
    expect(key).toBe("article:session-1");
    const parsed = JSON.parse(value);
    expect(parsed.fullText).toBe("First sentence.");
  });

  it("accumulates DeepSeek SSE text and saves to KV", async () => {
    const input = createSSEStream([
      'data: {"choices":[{"delta":{"content":"DeepSeek "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"output"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const output = teeAndSaveArticle(input, "session-2", env, "test", undefined);

    await readStreamToEnd(output);

    await vi.waitFor(
      () => {
        expect(kvPut).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const [, value] = kvPut.mock.calls[0];
    const parsed = JSON.parse(value);
    expect(parsed.fullText).toBe("DeepSeek output");
  });

  it("saves with custom rule in session data", async () => {
    const input = createSSEStream([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
    ]);

    const output = teeAndSaveArticle(input, "s3", env, "Video ABC", "请用幽默风格");

    await readStreamToEnd(output);

    await vi.waitFor(
      () => {
        expect(kvPut).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const [, value] = kvPut.mock.calls[0];
    const parsed = JSON.parse(value);
    expect(parsed.videoTitle).toBe("Video ABC");
    expect(parsed.ruleUsed).toBe("请用幽默风格");
  });

  it("handles empty stream gracefully (no KV write)", async () => {
    const input = createSSEStream([]);

    const output = teeAndSaveArticle(input, "empty", env, "test", undefined);

    await readStreamToEnd(output);

    // No KV write for empty content
    await new Promise((r) => setTimeout(r, 500));
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("handles malformed SSE lines without crashing", async () => {
    const input = createSSEStream([
      'data: {broken json\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"valid"}]}}]}\n\n',
    ]);

    const output = teeAndSaveArticle(input, "s4", env, "test", undefined);

    await readStreamToEnd(output);

    await vi.waitFor(
      () => {
        expect(kvPut).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    const [, value] = kvPut.mock.calls[0];
    const parsed = JSON.parse(value);
    // Only the valid line was accumulated
    expect(parsed.fullText).toBe("valid");
  });

  it("does not block the client stream (parallel consumption)", async () => {
    // Large enough stream to verify parallel consumption works
    const chunks: string[] = [];
    for (let i = 0; i < 100; i++) {
      chunks.push(`data: {"candidates":[{"content":{"parts":[{"text":"chunk${i}"}]}}]}\n\n`);
    }

    const input = createSSEStream(chunks);
    const output = teeAndSaveArticle(input, "parallel", env, "test", undefined);

    // Read client stream — must complete without hanging
    const result = await readStreamToEnd(output);
    expect(result).toContain("chunk0");
    expect(result).toContain("chunk99");

    await vi.waitFor(
      () => {
        expect(kvPut).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});
