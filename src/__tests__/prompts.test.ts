import { describe, it, expect } from "vitest";
import { buildArticlePrompt, build5W1HPrompt, buildArticleMessages, build5W1HMessages } from "../backend/prompts";

describe("buildArticlePrompt (Gemini format)", () => {
  it("includes subtitle in the prompt", () => {
    const prompt = buildArticlePrompt("Hello world");
    expect(prompt).toContain("Hello world");
    expect(prompt).toContain("字幕内容");
  });

  it("includes default system instructions when no rule", () => {
    const prompt = buildArticlePrompt("test subtitle");
    expect(prompt).toContain("Markdown");
    expect(prompt).toContain("话题概括");
    expect(prompt).not.toContain("严格遵循以下用户要求");
  });

  it("includes custom rule when provided", () => {
    const prompt = buildArticlePrompt("test", "请用幽默风格写出");
    expect(prompt).toContain("严格遵循以下用户要求");
    expect(prompt).toContain("请用幽默风格写出");
  });

  it("handles whitespace-only rule as no rule", () => {
    const prompt = buildArticlePrompt("test", "   ");
    expect(prompt).not.toContain("严格遵循以下用户要求");
  });

  it("is a single string (not messages array)", () => {
    const prompt = buildArticlePrompt("sub", "rule");
    expect(typeof prompt).toBe("string");
  });
});

describe("build5W1HPrompt (Gemini format)", () => {
  it("includes chapter title and full text", () => {
    const prompt = build5W1HPrompt("Chapter 1", "Full article text here");
    expect(prompt).toContain("Chapter 1");
    expect(prompt).toContain("Full article text here");
  });

  it("includes 5W1H JSON format instructions", () => {
    const prompt = build5W1HPrompt("Ch", "text");
    expect(prompt).toContain("who");
    expect(prompt).toContain("what");
    expect(prompt).toContain("why");
    expect(prompt).toContain("how");
  });

  it("requires strict JSON output without markdown", () => {
    const prompt = build5W1HPrompt("Ch", "text");
    expect(prompt).toContain("不要包含 markdown 代码块");
  });
});

describe("buildArticleMessages (DeepSeek format)", () => {
  it("returns messages array with system and user roles", () => {
    const messages = buildArticleMessages("subtitle text");
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("user message contains subtitle", () => {
    const messages = buildArticleMessages("my subtitle");
    expect(messages[1].content).toContain("my subtitle");
  });

  it("custom rule appends to system message", () => {
    const messages = buildArticleMessages("sub", "用简洁的风格");
    expect(messages[0].content).toContain("用简洁的风格");
  });
});

describe("build5W1HMessages (DeepSeek format)", () => {
  it("returns messages array", () => {
    const messages = build5W1HMessages("Ch1", "article text");
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(2);
  });

  it("user message includes chapter and article context", () => {
    const messages = build5W1HMessages("Introduction", "Long article");
    expect(messages[1].content).toContain("Introduction");
    expect(messages[1].content).toContain("Long article");
  });
});
