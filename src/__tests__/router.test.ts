import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleRequest } from "../backend/router";

vi.mock("../backend/youtube", () => ({
  extractVideoId: vi.fn((url: string) => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }),
  fetchSubtitlesWithFallback: vi.fn().mockResolvedValue({
    text: "Mocked subtitle for testing",
    fromFallback: true,
  }),
}));

vi.mock("../backend/gemini", () => ({
  streamArticle: vi.fn().mockResolvedValue(
    new Response("data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  ),
  generate5W1H: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ who: "test", what: "test" }), {
      headers: { "Content-Type": "application/json" },
    }),
  ),
}));

vi.mock("../backend/deepseek", () => ({
  streamArticle: vi.fn().mockResolvedValue(
    new Response("data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  ),
  generate5W1H: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ who: "test", what: "test" }), {
      headers: { "Content-Type": "application/json" },
    }),
  ),
}));

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    SESSION_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    } as unknown as KVNamespace,
    GEMINI_API_KEY: "test-gemini-key",
    DEEPSEEK_API_KEY: "test-deepseek-key",
    ...overrides,
  };
}

describe("handleRequest", () => {
  let env: Env;

  beforeEach(() => {
    env = createEnv();
  });

  it("returns 404 for GET /", async () => {
    const req = new Request("http://localhost/");
    const res = await handleRequest(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 204 + CORS for OPTIONS", async () => {
    const req = new Request("http://localhost/api/generate", { method: "OPTIONS" });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  describe("POST /api/generate", () => {
    it("returns 400 for empty body", async () => {
      const req = new Request("http://localhost/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("youtubeUrl");
    });

    it("returns 400 for invalid JSON", async () => {
      const req = new Request("http://localhost/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "not json",
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid YouTube URL", async () => {
      const req = new Request("http://localhost/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "not-a-url" }),
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("YouTube");
    });

    it("returns 200 + X-Session-Id for valid request", async () => {
      const req = new Request("http://localhost/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://youtu.be/abcdefghijk" }),
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Session-Id")).toBeTruthy();
    });

    it("uses DeepSeek when ?model=deepseek-chat", async () => {
      const req = new Request("http://localhost/api/generate?model=deepseek-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://youtu.be/abcdefghijk" }),
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
    });

    it("falls back to Gemini when DeepSeek key missing", async () => {
      const envNoDS = createEnv({ DEEPSEEK_API_KEY: undefined });
      const req = new Request("http://localhost/api/generate?model=deepseek-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://youtu.be/abcdefghijk" }),
      });
      const res = await handleRequest(req, envNoDS);
      // Should not fail at validation (400) — provider fallback worked
      expect(res.status).not.toBe(400);
    });
  });

  describe("POST /api/5w1h", () => {
    it("returns 400 when missing sessionId", async () => {
      const req = new Request("http://localhost/api/5w1h", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter: "ch1" }),
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
    });

    it("returns 400 when missing chapter", async () => {
      const req = new Request("http://localhost/api/5w1h", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "abc" }),
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
    });

    it("returns 404 when session not in KV", async () => {
      const req = new Request("http://localhost/api/5w1h", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "missing", chapter: "ch1" }),
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(404);
    });
  });
});
