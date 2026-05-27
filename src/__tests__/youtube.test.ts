import { describe, it, expect } from "vitest";
import { extractVideoId } from "../backend/youtube";

describe("extractVideoId", () => {
  it("parses standard youtube.com/watch URL", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses youtube.com/watch with extra query params", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=xRh2sVcNXQ8&t=30")).toBe("xRh2sVcNXQ8");
  });

  it("parses youtu.be short URL", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses youtu.be with query params", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
  });

  it("parses youtube.com/embed URL", () => {
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube URLs", () => {
    expect(extractVideoId("https://example.com/video")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractVideoId("")).toBeNull();
  });

  it("returns null for YouTube URL missing video ID", () => {
    expect(extractVideoId("https://www.youtube.com/watch")).toBeNull();
  });

  it("returns null for malformed youtu.be", () => {
    expect(extractVideoId("https://youtu.be/")).toBeNull();
  });

  it("parses URL without protocol", () => {
    expect(extractVideoId("youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
  });

  it("handles URL with uppercase characters in ID", () => {
    expect(extractVideoId("https://youtube.com/watch?v=AbCdEfGhIjK")).toBe("AbCdEfGhIjK");
  });

  it("handles hyphens and underscores in video ID", () => {
    expect(extractVideoId("https://youtube.com/watch?v=a1b_-c2D3eF")).toBe("a1b_-c2D3eF");
  });
});
